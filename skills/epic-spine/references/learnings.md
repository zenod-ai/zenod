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

## Saving a learning

Triggers: the user repeats a correction (same correction twice, or "again" / "I told you"), or states a general preference (`always…`, `never…`, `I prefer…`). The agent writes the learning **immediately, without asking**, in the same turn, then announces it in one line at the end of the reply:

```
Saved learning L-<n>: <the rule> (say 'undo' to remove)
```

- Scope: the deepest spine the rule applies to (a branch spine for work inside it; the root **Always** for a repo-wide rule, the **Scoped index** with a pointer for a trigger-specific one). `L-<n>` is the next number in that section; replace a `- (none yet)` placeholder. If root **Always** would pass 12 lines, move the least useful row to a child spine or the Scoped index.
- No spine in the repo: write nothing and offer a spine once (global block rule 3).
- `undo` (or "remove that") deletes the line; no trace. A reversed preference supersedes the old line (`supersedes L-<n>`).
- Commit it with the next spine update, per `Integration policy:`. Never throttle; one-off task instructions are not learnings.

## Reversals: sweep the repo for the old rule

Repo text outranks the skill (repo values > global block), so a reversed rule that survives anywhere in the repo keeps steering agents (2026-10-16: a profile still said "always dispatch to DeepSeek" long after the user dropped it). When a saved learning changes or reverses an earlier rule (a model choice, a dispatch target, a process step):

- In the same commit, search the repo (`git grep -i`) for the old rule and fix every **current** instruction that still says it: spines (Next action, Operating Learnings, Current State), operator profiles, `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`, dispatch briefs, templates, scripts' help text.
- Leave history alone (logs, closed ledger rows, changelog, decision records), but if a history line could read as current guidance, mark it `superseded` or `(historical)`.
- Vendored copies of the skill itself are not edited by hand; SessionStart flags old ones (`references/session-sync.md`) for the user to update or remove.
- Name what was fixed in the `Saved learning` reply.

## Promotion and pruning

- A scoped learning confirmed in 2+ sibling branches is promoted to the parent by the steward.
- A learning not confirmed for 180 days is flagged to the user for pruning; never auto-delete it.

## Roles

The agent the user is talking to (typically the delivery manager, the spine steward) writes. A worker that hears a qualifying correction hands it back as a `Learning candidates:` line; the manager writes it without asking and announces it.

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
