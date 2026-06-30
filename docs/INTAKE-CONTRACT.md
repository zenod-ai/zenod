# Intake Contract — the one pattern that covers every message

The Console is a **thin router**, not a thick interpreter. Its job is to decide
*where* a request goes and to keep a durable record — never to re-interpret *what*
a task means. The owning agent (Codex for execution) does the interpreting.

> **Console decides WHERE. The agent decides WHAT. The Console never rewrites task content.**

This is the cure for the over-decomposition / hallucination / whack-a-mole loop:
fewer interpretation steps, each grounded in a real record or receipt.

## The three steps (every inbound message, no exceptions)

1. **CLASSIFY** — one decision: which capability(ies), and is this *one* task or
   genuinely several? Default to **one**. Only treat it as several when the user
   explicitly enumerates ("another ticket", "separate task", "two things", "also
   <do Y>"). Don't shatter a richly-described single task into fragments.
2. **RECORD** — create the durable artifact for the chosen capability. For code/ops
   that is a **GitHub execution issue** whose body is the user's **verbatim words**
   (plus the resolved repo/path). The record always exists; "pass-through" means we
   don't rewrite the content, NOT that we skip the issue.
3. **ROUTE** — hand the record to the owning agent. **Report only on its receipt** —
   never claim created/queued/running/sent/done without the same-turn tool result.

## The capabilities = the agents (this is the whole taxonomy)

| Capability | Owner | Durable record |
| --- | --- | --- |
| remember / recall | Zenod | vault note |
| backlog change (create/edit/close issue) | Archus | backlog issue |
| **execute code/ops** | **Epaminon → Codex** | **execution issue (verbatim body)** |
| send outward (X / Reddit / email) | Callistheness | sent-item evidence URL |
| notify the principal | Phylax | notification ledger entry |
| just answer | Console | (none — direct reply) |

There are ~6 capabilities, each with exactly one owner. There is no seventh
"ambiguous ask" type — if it's unclear, ask one question (clarify), don't guess.

## The execute fast-lane (the "get out of the way" rule)

When a message names **codex / Epaminon + an action** ("task for codex", "have
Epaminon run this", "give this to codex"), the Console takes the **fast-lane**:

- **Skip decomposition entirely.** It is one task.
- File **one** execution issue with the user's **verbatim transcript** as the body
  (repo/path resolved from the project registry).
- Hand it to Epaminon → Codex. Codex reads the words and does the work.

The Console must NOT digest, split, re-classify, or "improve" an execute directive.
Codex is the intelligence; the Console just gives it the task and keeps the ticket.

## Why this stops the whack-a-mole

- **One classification decision**, not five interpretation layers that interact.
- **Independent lanes**: a change to `execute` cannot break `remember` or `send` —
  they share no interpreter. One regression fixture per lane makes "fixed one, broke
  another" un-shippable.
- **Grounding over guards**: every claim is backed by a real record/receipt, so we
  delete correction-prefixes and validators instead of adding more.

## Invariants (never violate)

- Every action has exactly **one durable record** and **one owner**.
- The Console **never** says created/queued/running/sent/stored/done without a
  same-turn receipt.
- An execute directive is filed **verbatim** — the user's words are the task.
- Missing the genuinely-required field (a repo for code work, an unclear objective)
  → ask **one** question. Never invent it; never silently drop it.

## Migration status

- ✅ `execute` lane: one-off → `runEphemeralTask` → create-issue-then-run →
  Epaminon (ticket-backed; `ensureRunnableBody` auto-fills ceremony).
- ✅ Fast-lane: `isExecuteDirective` skips decomposition for codex/Epaminon tasks.
- ⏳ Move the single-vs-multi + capability decision fully onto the LLM+contract and
  retire the remaining deterministic splitter (keep it only as a conservative aid).
- ⏳ One behavioral regression fixture per capability lane (real transcripts).
