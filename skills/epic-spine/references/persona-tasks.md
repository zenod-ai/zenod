# Persona tasks: writing contract for personas sharing a repo

Several personas work one repo and one epic. This is how they hand work to each other without overwriting each other. Persona and `## Team` formats: [personas.md](personas.md). Ledger and ask formats: [spine-model.md](spine-model.md).

## A task is a ledger row

- A task is an Issue Ledger row with an assignee in `Owner / Assignment` and a Status (draft / ready / active / blocked / done / superseded / deferred). One row per job; several jobs, several rows. The assignee is a persona on the epic's `## Team` table, or `Jordi`.
- **Queue.** Every persona wake starts with its queue: the open rows (not done, superseded or deferred) assigned to it, in every epic whose `## Team` table names it. Work the queue, then the epic's Next action; an empty queue means check Team cadence and stop.
- **Hand-off = reassign the row.** Change the assignee, set Status `ready`, put what the next persona needs in Next Action, and commit. Never finish someone else's row, and never keep a row you cannot do.
- **Another goal's task.** A task that serves a different goal goes in that goal's ledger, with a link back from the originating row (Depends On or Next Action).
- **Outgrown task.** A row that needs more than a wake or two becomes a child epic (`spine_new.py`); the row stays as the pointer and rolls up the child's Outcome.

## Every action is signed

Every action is a commit, signed by the persona with a trailer next to the run trailer:

```
Persona: <name>
Run: <run id>
```

A commit touches only what the persona's write scope allows. No commit, no action: unrecorded work did not happen.

## Shared files keep one shape

- A shared file (spine, ledger, log) keeps its fixed shape: personas edit rows and sections, never restructure them.
- Each section has one named writer: the persona whose Team-table write scope covers it. Everyone else proposes through a ledger row assigned to that writer, never by editing the section.
- The epic's active steward still reconciles Current State ([spine-model.md](spine-model.md)); a persona's write scope only widens that by name.
- `git pull --rebase` before each push. A conflict in a section you do not own: take theirs, reassign a row to its writer.

## Asks as tasks (trial)

**Trial:** on infra-vps EPIC-15 only. It is adopted or dropped by a Decisions row in EPIC-5 after the trial; until then no other repo uses it.

An ask to Jordi is a ledger row assigned to `Jordi`, Status `blocked` on the work it holds up. Its Next Action (or a linked page) carries the same fields as an ask, plain words first:

- **what**: the decision or action wanted
- **why**: why it comes up
- **impact**: what it unblocks, the cost of waiting
- **risk + rollback**: what could go wrong and how to undo it
- **recommendation**: the option you pick and why

**Meanwhile, the coded ask line stands.** The `## Waiting on` line ([spine-model.md](spine-model.md)) is still the ask of record: it keeps its code (`<epic>-A<n>`), the answer protocol and the ≤3 limit. In the trial, write both: the `Jordi` row carries the ask fields and its Next Action cites the code, and the `## Waiting on` line stays short and links the row id. One ask, two views; the answer rewrites the tag as spine-model.md says and sets the row done. If the two ever disagree, the `## Waiting on` line wins. Ask-tier rules do not change: only ask for the step that blocks now.
