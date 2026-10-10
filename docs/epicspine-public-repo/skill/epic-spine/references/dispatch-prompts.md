# Bootstrap And Dispatch Prompts

The bootstrap response shape and the paste-ready dispatch prompt shapes.

## Bootstrap Response

When orienting another agent or user, return this shape:

```markdown
Current state: ...
Spine lineage: <root -> ... -> bound spine>
Bound role: ...
Bound spine: ...
Bound issue: ...
Spine steward: ...
Book binding: inactive | <root, chapter/leaf, Book steward, author scope>
Goal: ...
Acceptance target: ...
Read path followed: ...
Active issues: ...
Integration target and base: ...
Human gates: ...
Drift or blockers: ...
Last attempted / result: ...
Waiting on: ...
Approved work: ...
Recommended next action: ...
```

Keep it concise; the spine is the durable record.

## Dispatch Prompt Shape

When spawning or briefing workers, use this shape:

```markdown
Use $epic-spine.
Identity: Epic 0 worker | epic worker | ticket worker | tester | planner | reviewer | observer
Bound spine: <path or URL>
GitHub issue: <URL>
Role: Epic 0 worker | epic worker | ticket worker | tester | planner
Spine steward: <task/thread/agent responsible for reconciling the spine>
Assignment identity: <stable task/thread/agent/owner>
Write scope: write detailed work to the issue; edit the spine only if you are its steward or a narrow section is explicitly delegated. Referenced spines are read-only unless listed.
Book binding: inactive | <Book root; owning chapter/leaf; Book steward; author permissions; registry permissions; validation command>
Branch: wt/<task> (local; no push or PR by default)
Base commit: <SHA>
Integration target: <main or declared branch>
Required reads: <bootstrap map links>
Acceptance criteria: <issue and spine criteria>
Human gates: <named approvals or none>
Handoff: update the issue with branch, commits, validation evidence, blocker, and next action; notify the spine steward to reconcile durable state.
```

For an Epic 0 worker that owns the project picture, use:

```markdown
Use $epic-spine.
Identity: Epic 0 worker
Bound spine: <project Epic 0 spine path or URL>
Goal: keep the full project picture and state, create or update child EpicSpines, bind child workers, and loop until the project has clear next actions or needs human input.
Authority: update the Epic 0 spine, create child spine drafts, create/update GitHub issues for coordination, and dispatch child epic workers; referenced child spines are read-only unless explicitly listed.
Child-spine rule: child epic workers own delivery inside their bound child spine; Epic 0 records rollups, dependencies, decisions, health, and cross-epic state.
```

For an epic worker that will dispatch subagents, use:

```markdown
Use $epic-spine.
Identity: epic worker
Bound spine: <path or URL>
Goal: deliver this epic until it is ready for human test, tester handoff, or blocked by required input.
Authority: create/update GitHub issues within existing scope, dispatch ticket workers, and update the bound spine; do not change acceptance or cross-spine scope without planner/user input.
Steward rule: the epic worker is the active steward for the bound child spine; ticket workers and testers return structured issue handoffs unless explicitly delegated a narrow spine section.
Subagent rule: each ticket worker writes deep detail into its assigned GitHub issue; the epic worker writes only clean state, links, blockers, and durable outcomes into the spine.
Integration rule: every dispatched worker/tester uses a local `wt/<task>` branch and separate worktree, then the delivery manager integrates verified work to `main` under `references/git-doctrine.md` so new agents start from the freshest validated base.
```

