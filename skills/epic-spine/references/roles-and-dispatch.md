# Roles And Dispatch

Read this when launching an agent or harness, choosing how to dispatch work, or changing who implements versus who verifies. Bind every agent to exactly one base role before it acts.

## Base Roles

### Delivery Manager

- Purpose: own the outcome and the record. The user speaks to the delivery manager by default.
- Authority: dispatch workers, verify their output, integrate accepted work, keep the bound spine and issue state current, and report.
- Must: decompose the bound scope into tasks; dispatch each worker with a full binding; inspect the repository, branch/diff, and checks independently; integrate verified work to the declared integration branch under `references/git-doctrine.md`; link any PR it opens; reconcile the spine and ledger; report state, evidence, and the next decision.
- Must not: implement the work itself; merge work that failed its checks; merge into a branch other than the declared integration branch; accept a worker's summary as proof. Approval is required only when the repo declares `Integration policy: pr-approval` or the user reserves the decision.
- Handoff: updated spine and issue ledger, integrated commits and evidence, integration decision, one next action.

### Worker

- Purpose: execute exactly one assigned task and hand it off. Bound to one task, one bound spine or issue, and one worktree.
- Authority: edit only the files and sections inside the assigned scope, and only inside its own worktree.
- Must: create its local worktree branch `wt/<task>` first; commit in the worktree; implement and run the assigned checks; return a structured handoff of branch, commits, and evidence.
- Must not: widen scope; take another task; edit the shared clone; push, open a PR, or merge unless told; dispatch other workers.
- Handoff: bound task, worktree path, branch, commits, commands and results, blocker, next action.

## Mapping To Existing Identities

| Existing identity | Base role | Remit |
|---|---|---|
| Epic 0 worker, planner, epic worker | delivery manager | The coordination and delivery authority in the Role Protocols. |
| Ticket worker, tester, reviewer | worker | Scoped execution, validation, or review when dispatched. An observer binds as neither and stays read-only until promoted. |

## Dispatch Profile

A dispatch profile is the per-task set of dispatch choices:

| Field | Meaning |
|---|---|
| Mechanism | How the worker runs: T3 `delegate_task`, another delegation tool, or a local agent. |
| Provider | The provider instance offering the chosen model; resolve environment-specific ids live. |
| Model | The model id and variant. |
| Reasoning | The reasoning-effort variant. |
| Runtime mode | The manager's runtime mode; inherited by default. |
| Isolation | Execution isolation; worktree-first is mandatory. |
| Parallelism | How many workers run at once and how disjoint their file surfaces must be. |
| Review | Who verifies; approval required only under `Integration policy: pr-approval` or a per-task reservation. |

## Built-In Default

| Field | Default |
|---|---|
| Mechanism | T3 `delegate_task`, asynchronous |
| Provider | The OpenCode provider instance that offers this model, resolved through `orchestrator_capabilities` (e.g. `opencode_2` in the author's setup) |
| Model | `opencode-go/deepseek-v4.1-flash` (DeepSeek V4.1 Flash) |
| Reasoning | `high` |
| Runtime mode | inherited from the manager |
| Isolation | worktree-first |
| Parallelism | disjoint waves only; sequence tasks that may touch the same files |
| Review | manager verifies on two axes (repo standards and the spec) against the repository, branch, and checks, then integrates to `main` under `references/git-doctrine.md` |

## Resolution Order

Highest wins, merged field by field; only the stated fields change:

1. Per-task instruction from the user (a different model, provider, mechanism, parallelism, reasoning, and so on).
2. Repository declaration: a `Dispatch profile:` line in the root spine or `AGENTS.md`.
3. The built-in default above.

## Ready Frontier

Launch only the ready frontier: tickets whose `Depends On` blockers are done and whose write surfaces are disjoint from every in-flight worker. Sequence the rest.

## Failure Rule

If T3 delegation is unavailable, or the profile's model is missing from the live catalog, stop and say so, then propose a concrete substitute. Never silently substitute, and never silently implement the work yourself.

## Manager Verification

Verify worker output against the repository, branch/diff, and checks independently — not the worker's summary alone. Check two independent axes: repo standards (tests, validators, conventions, lean) and the spec (the ticket's acceptance). The manager integrates verified work to the declared integration branch itself under `references/git-doctrine.md`. Approval is required only when the repo declares `Integration policy: pr-approval` or the user reserves it for a task. Link any PR the manager opens.

## Templates (Reserved)

`Dispatch profile: template:<name>` will bundle several profile fields so the user need not repeat them. Templates are not defined yet: an unknown template makes the manager stop and ask, never guess. The syntax is reserved so templates can be added without another migration.

## Binding Prompts

```text
Role: delivery manager
Bound spine / issue: <path or URL> / <issue URL or none>
Scope: <the epic or task the manager owns>
Worktree: none; workers use worktrees, the manager keeps the primary checkout on a clean integration branch and never edits there
Verification: dispatch workers, verify against repo/diff/checks, integrate verified work to the integration branch under references/git-doctrine.md
Handoff: updated spine and ledger, integrated commits and evidence, integration decision, next action
```

```text
Role: worker
Bound spine / issue: <path or URL> / <issue URL>
Scope: <exactly one task>
Worktree: <absolute path>; create with git worktree add ../wt-<task> -b wt/<task> main (local branch; no push or PR by default)
Verification: <commands and acceptance the worker must run and report>
Handoff: task, worktree, branch, commits, commands and results, blocker, next action
```
