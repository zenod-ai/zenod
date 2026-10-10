# Operating Learnings

Operating learnings are the repo's living, navigable memory of how to work with an agent. They live in the spine tree at the depth where they apply, so a bound agent reads only what its task needs.

## One line per learning

```
L-<n> | applies when | the rule, imperative | why (≤ 8 words) | confirmed YYYY-MM-DD
```

- `L-<n>` is stable within its spine section; never renumber it.
- The rule is imperative and one line. If it needs more than ~3 lines of explanation, keep this line and point to detail in the owning branch spine's own learnings section or, if the Book is active, a Book leaf — no new file kinds.
- A newer line may carry `supersedes L-<n>`; strike the old line, keep it one cycle, then the steward removes it.

## Depth is scope

- A root `## Operating Learnings` section has two parts:
  - **Always** — applies to every task; read in full at bind; hard cap 12 lines.
  - **Scoped index** — one row per scoped learning: an `applies when` trigger (for example `touching the validator` or `dispatching UI work`) pointing to the child spine or leaf that owns it.
- A child or branch spine holds its own `## Operating Learnings` in the same one-line format for work inside it.

Navigation: read root **Always**; match the task against the **Scoped index** triggers; follow only matching pointers; descend until no deeper match. Never read learnings for non-matching branches.

## Precedence

The user's current instruction > deeper (more specific) learning > shallower learning. A present instruction always wins.

## Bind-time brief

A newly bound agent's FIRST reply includes `Learnings in force:` — at most 5 lines naming the learnings it will apply to this task. No recital of non-matching learnings.

## Proposing a learning

The agent proposes when (a) the user gives the same correction or instruction twice, (b) the user states a general preference (`always…`, `never…`, `I prefer…`), or (c) the agent just paid a real cost for a pitfall. Append at the END of the reply, max 3 lines:

```
Propose learning (<scope: root | branch X>): <one-line rule> — record it?
```

The agent never writes a learning silently. Proposals are rare: at most one per reply, and none in consecutive replies.

On **yes**, the spine steward writes the learning at the broadest correct scope; if unsure between root and branch, ask in the same line. On **no**, record a `rejected` row in Decisions so it is not re-proposed.

## Promotion and pruning

- A scoped learning confirmed in 2+ sibling branches is proposed for promotion to the parent.
- A learning not confirmed for 180 days is proposed for pruning; never auto-delete it.

## Roles

Any bound agent may PROPOSE; only the spine steward (typically the delivery manager) WRITES. Workers hand learning candidates back in their handoff as `Learning candidates:` lines.

## Worked example

Root `## Operating Learnings`:

```
Always:
- L-1 | any change | run the full test suite before handoff | broken main blocks everyone | confirmed 2026-10-01
Scoped index:
- editing the validator → [validator branch](validator.md)
```

`validator.md` `## Operating Learnings`:

```
- L-1 | editing the validator | add a test for every new diagnostic | regressions slip silently | confirmed 2026-10-01
```

A worker touching the validator reads root Always and follows the pointer; a worker touching docs reads only Always.
