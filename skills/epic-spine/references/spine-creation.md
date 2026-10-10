# Spine Creation, Rollups, And Document Rules

How to create and register a spine, roll up children, keep the execution cursor, and what every spine document must contain.

## Workflow

1. **Enter through the root.** Follow the repository's start-here pointer to the canonical root spine. If the user supplied a spine directly, verify its declared root and parent before treating it as bound.
2. **Follow the active branch.** Read direct-child rollups and follow only the active/relevant branch until reaching the spine whose mission contains the requested work.
3. **Create only when needed.** If no suitable spine exists, use the spine-creation protocol below and `assets/compact-spine-template.md` (or the explicit full legacy template when needed); do not create an orphan document.
4. **Establish write scope.** Identify the bound spine and its active steward. Treat root, parent, child, and sibling spines as read-only unless the user explicitly grants write authority or creation includes an atomic parent registration.
5. **Establish role binding.** Identify whether this agent is Epic 0 worker, planner, epic worker, ticket worker, tester, reviewer, or observer. Apply that role's authority limits before taking action.
6. **Build the bootstrap map.** Extract mission, non-goals, acceptance, the authoritative Current State, Issue Ledger, Decisions and required links; read hierarchy and legacy cursor only when present.
7. **Detect Book binding.** Read the repository's Book declaration, if active, then open the Book root and the chapter relevant to the task. Treat the binding as automatic; do not wait for a second user instruction.
8. **Reconcile execution state.** Inspect GitHub issues, PRs, branches, current code, and validation evidence only after the spine has oriented you. Resolve each fact using the authority-by-artifact contract and flag drift.
9. **Check durable memory.** Before proposing a recurring approach, search Decisions in the bound spine and relevant ancestors for rejected or superseded paths. Read the root `Operating Learnings` **Always** list and follow the **Scoped index** triggers that match this task. If the Book is active, also search its chapters and leaves for an existing owner of the question.
10. **Act in role.** Continue from the authoritative state (or reconciled legacy cursor) and apply the relevant role protocol.
11. **Write back and roll up.** Update detailed work in the issue, the bound spine's durable state and cursor if steward, and a compact direct-child rollup in the parent through its steward. Land durable user-facing knowledge in the Book leaf and owning chapter when the Book trigger applies.

## Spine Creation And Registration

Creating a spine is a relationship change, not just a file write:

1. Search the existing Spine Maps and choose the narrowest parent whose mission contains the new work.
2. Prefer branching under the canonical root. Create another root only when the ambition is intentionally independent, and record an Additional Root Rationale.
3. Assign a stable Spine ID; declare `root` or `branch`; link the root and parent; name the initial steward, acceptance boundary, and integration target.
4. Initialize one Current State, Decisions and Issue Ledger from the compact template; add Spine Map for direct children. Do not add a competing live cursor.
5. Register the new spine in the parent's Spine Map with purpose, status, health/blocker, latest evidence, last rollup time, and next action.
6. Make the child-to-parent and parent-to-child links part of one reviewed change when write authority permits. Otherwise create the child as `draft`, record `registration pending`, and send an exact proposed update to the parent steward; do not present it as connected yet.
7. Run `scripts/validate_spine.py --strict` on the new spine and `--graph` across the affected local spine family when possible.

Do not create a sub-spine merely because a ticket is large. Create one when a durable ambition needs its own acceptance, steward, backlog, decision memory, and execution cursor.

## Rollup Contract

Each parent Spine Map contains one row per direct child. Reconcile that row whenever the child's phase, health, blocker, latest evidence, or next action changes.

A rollup contains only:

- child Spine ID and link;
- one-sentence purpose;
- phase/status;
- health or exact blocker;
- latest evidence;
- absolute last-rollup time;
- one next action.

The child remains authoritative for detail. Parents aggregate direct children only; root-level health emerges through recursive one-level rollups. A parent must not mark a child `done` without the child's acceptance evidence.

## Execution Cursor And Decision Memory

Current State is the authoritative resume point for compact spines. Update it whenever execution stops, changes owner, or crosses a human gate. An Execution Cursor in a legacy full spine remains supported; overlapping facts must agree until the steward reviews a migration. New handoffs and queues link to state or carry generated projections rather than independently authored copies.

The cursor records:

- last attempted action;
- actual result and evidence;
- current execution status;
- what or whom it is waiting on;
- approved work that may proceed without another planning turn;
- the exact next action.

Use Decisions as durable anti-repetition memory. Record accepted, rejected, and superseded approaches with a compact summary and a link to detail. A rejected entry must say what was tried, why it was rejected, its evidence, and the condition—if any—that would justify reconsidering it. Keep investigation detail in issues, PRs, ADRs, or source memories.

## Spine Document Rules

- Preserve history. Append dated decisions and handoffs instead of overwriting the rationale.
- Prefer links over duplication, but keep enough summary text for fast bootstrap.
- Keep the spine high-signal: intent, desired outcome, current state, dependencies, decisions, acceptance, and evidence links belong here; raw debugging detail, code exploration, long blocker discussion, and work logs belong in GitHub issues or PRs.
- Every active issue should have one row in the issue ledger.
- Every row in the issue ledger should link to a GitHub issue unless it is explicitly marked `draft`.
- Acceptance criteria belong in the spine at epic level and in issues at ticket level.
- The current state section must be updated whenever the active phase, owner, blocker, or next action changes.
- The execution cursor must be updated whenever an execution cycle attempts work, stops, changes owner, or reaches a gate.
- Every spine must declare its stable ID, type, root, and parent; every branch must be registered in its parent's Spine Map.
- The Spine Map lists direct children only and must stay consistent with each child's declared parent.
- Before reviving an approach, inspect rejected and superseded Decisions and record why conditions have changed.
- Name the active spine steward, assignment identities, last reconciled commit, integration target, and human gates.
- Every active ticket must record owner, branch, base commit, latest verified time, and next action so another agent can take over.
- The write-scope section must identify which spine is writable for the current agent/role and which linked spines are read-only.
- When a Book companion is active, record the Book root, owning chapter or leaf, author scope, Book steward, canonical registry, and required validation in the task binding or spine bootstrap map.
- Use absolute dates when recording events.

