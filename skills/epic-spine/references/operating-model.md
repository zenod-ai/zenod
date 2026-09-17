# EpicSpine Operating Model

Read this when creating a new EpicSpine from scratch, repairing an inconsistent spine, or changing the planner/worker/tester workflow.

## Contents

- Prior art and artifact authority
- Connected hierarchy, creation, registration, and rollups
- Spine, issue, and write-scope boundaries
- Role binding and goal-seeking persistence
- GitHub issue board and integration flow
- Execution cursor, decision memory, human gates, recovery, and takeover
- Document health, status, drift, and handoffs

## Prior Art

EpicSpine combines several established practices:

- Spec-driven development: write a spec first and make it the durable source of truth for humans and agents.
- RFC/design-doc culture: write down intent, tradeoffs, dependencies, and decisions before major implementation.
- ADR practice: preserve decisions and rationale after the discussion has moved on.
- Working-backwards PR/FAQ practice: begin from the intended user-visible outcome and questions stakeholders will ask.
- Issue-tracked execution: use GitHub issues for bounded implementation and validation tickets.

The distinctive rule is that the epic document remains the clean bootstrap artifact and durable memory. Issues are synchronized execution records where deep ticket-specific detail can live.

## Connected Spine Hierarchy

An EpicSpine system is a canonical ownership tree with an optional wider knowledge graph:

- A repository or coherent project should normally expose one canonical root spine.
- Additional roots are permitted when they represent genuinely independent ambitions or integration authorities. The canonical root uses `Additional root rationale: n/a`; each additional root records why it cannot be represented as a branch. Unexplained roots are structural drift.
- Every non-root spine has exactly one canonical parent, exactly one inherited root, and any number of children. Nesting depth is arbitrary.
- Parent and root links define ownership and rollup. Related-spine links may connect siblings, roadmaps, memories, or architectures, but they never create a second canonical parent.
- Every spine has a stable Spine ID so that renames and moves do not silently change identity.

This produces a rooted tree in the normal case and an explicitly justified forest when multiple roots exist. Do not call an unregistered document a child merely because it links to another spine.

### Cold Start And Navigation

The repository should provide a small start-here pointer, often in `AGENTS.md`, that sends an agent to the canonical root. That router is not a second project-state document.

Cold-start order:

1. Read the root spine.
2. Read its direct-child rollups and follow the active or relevant branch.
3. Repeat until the work's bound spine is reached.
4. Read the bound spine's Current State, Execution Cursor, Decisions, Issue Ledger, and required bootstrap links.
5. Reconcile GitHub and the integration branch before execution.

This is the formal version of a useful resume instruction such as `continue`: the word itself contains no hidden project context; it means resume from the recorded cursor after verifying current execution reality.

## Spine Creation And Registration

Create a branch spine when a durable ambition needs its own acceptance boundary, steward, backlog, decision memory, and execution cursor. A large ticket alone is not enough.

Creation protocol:

1. Search from the root through existing Spine Maps. Select the narrowest parent whose mission contains the proposed work.
2. Prefer a branch. If creating another root, record an Additional Root Rationale.
3. Assign a stable Spine ID and declare type, root, parent, steward, repository, integration target, mission, and acceptance.
4. Initialize Spine Map, Current State, Execution Cursor, Decisions, Issue Ledger, and required authority/write-scope sections.
5. Add the branch to its direct parent's Spine Map.
6. Land both directions together when the creator may write both spines. Otherwise leave the child `draft`, record `registration pending`, and send the parent steward an exact proposed Spine Map row.
7. Validate the child locally and validate the affected family as a graph.

Registration is complete only when the child points to the parent and the parent lists the child. Until then, the document is a pending branch proposal, not a connected operational spine.

## Rollup Model

Every spine owns local truth for its mission, acceptance, execution cursor, issue ledger, decisions, and validation. Every parent owns compact direct-child rollups.

Required direct-child rollup fields:

| Field | Meaning |
|---|---|
| Spine ID / link | Stable child identity and navigation target |
| Purpose | One sentence describing the ambition owned by the child |
| Status | Child phase using the shared vocabulary |
| Health / Blocker | Healthy, or the exact blocking dependency/decision |
| Latest Evidence | Freshest proof supporting status |
| Last Rolled Up | Absolute reconciliation time |
| Next Action | One concrete action that advances or unblocks the child |

Roll up one level at a time. A root summarizes its direct children, including branch children that themselves summarize deeper descendants. This keeps the root navigable without duplicating entire descendant issue ledgers.

Rollup rules:

- The child is authoritative for its detailed state.
- The child steward publishes the rollup or sends a structured update to the parent steward.
- The parent steward reconciles the parent's row; normal aggregation does not grant authority to rewrite child detail.
- Update a rollup when phase, health, blocker, latest evidence, or next action changes.
- Never roll up `done` without child acceptance evidence.
- When parent and child disagree, mark drift and reconcile; do not silently choose the more optimistic status.

## Authority By Artifact

Use explicit authority instead of calling every surface a source of truth:

| Artifact | Authoritative For |
|---|---|
| EpicSpine | Intent, scope, epic acceptance, dependencies, decisions, and rollup state |
| GitHub issue | Detailed execution state for one ticket |
| Branch, PR, and code | The implementation that actually exists |
| Validation evidence | What passed or failed for an exact commit in a named environment |
| Epic 0 spine | Project direction, child-spine relationships, and cross-epic health |

The active spine steward reconciles these surfaces. If they disagree, prefer observable implementation and validation facts for what exists, then update the spine's durable state without silently changing intent or acceptance.

## Spine And Issue Boundary

The spine is the thread of intent, desire, context, fit, and state:

- why the epic exists;
- what outcome is desired;
- how the work fits with parent, child, and sibling tracks;
- what the current state is;
- which decisions and dependencies matter;
- which issues, PRs, and evidence prove progress;
- what the next planner, worker, or tester should do.

GitHub issues are the deep surface for a specific executable step:

- code paths and implementation notes;
- blockers and blocker investigation;
- logs, screenshots, stack traces, and command output;
- ticket-level review discussion;
- detailed validation notes;
- follow-up discoveries.

Write back from issue to spine only when the detail changes durable state: intent, scope, acceptance criteria, dependencies, risk, owner, status, evidence, or next action.

## Write-Scope Model

An agent must know which spine it is bound to before editing anything.

- **Bound spine:** the writable source-of-truth document for the current task.
- **Referenced spine:** any linked parent, child, sibling, portfolio, roadmap, or meta-spine used for context.
- **Portfolio spine:** a parent/meta-spine that rolls up multiple epics and owns cross-epic health, dependencies, and decisions.
- **Epic 0 spine:** the root/project spine. It holds the full project context, thrust, child-spine map, cross-epic state, and desired operating behavior.
- **Branch spine:** any non-root spine at any nesting depth. It owns its local mission, execution state, ticket ledger, validation evidence, and decisions.
- **Spine steward:** the one active agent responsible for reconciling and committing a spine at a given time.

Use one active steward per spine:

- The Epic 0 worker normally stewards the root/project spine.
- The epic worker normally stewards a child spine during delivery.
- A planner may steward a spine during planning when explicitly bound.
- Ticket workers and testers write detailed state to their issue and submit structured handoffs by default.
- Delegate a narrow spine section explicitly when another role must write directly. Do not allow concurrent rewrites of mission, acceptance, current state, or the issue ledger.
- Transfer stewardship by recording the outgoing steward, incoming steward, time, current commit, and next action.

Default permissions:

| Role | Bound Spine | Referenced Spines |
|---|---|---|
| Epic 0 worker | Steward root/project state, child-spine map, rollups, cross-epic decisions, dispatch notes | Read all child spines; create/propose child spines |
| Portfolio planner | Steward explicitly bound planning/rollup sections | Read; propose child updates |
| Epic planner | Steward scope, issues, and decisions while explicitly bound for planning | Read; propose parent/sibling updates |
| Epic worker | Steward bound child-spine delivery state, create/update issues, dispatch ticket workers | Read; propose parent/sibling updates |
| Ticket worker | Write code, issue detail, PR, and structured handoff; write a spine section only if delegated | Read only |
| Tester | Write issue evidence and structured handoff; write validation section only if delegated | Read only |
| Reviewer | Read unless explicitly delegated | Read only |

When a parent spine references child spines, do not let the parent agent directly mutate child detail by default. It should record a proposed child-spine update and route it to the child spine's steward. Reciprocal registration during authorized spine creation is the narrow exception.

## Role-Binding Model

An EpicSpine role is an operating identity. A fresh agent or harness becomes part of the discipline when it is bound to:

- one role;
- one bound spine;
- one bound issue or ledger row when doing ticket work;
- one named spine steward;
- one stable assignment identity;
- one handoff contract.

Use this prompt pattern:

```markdown
Use $epic-spine.
You are now the <Epic 0 worker|planner|epic worker|ticket worker|tester|reviewer|observer> for <Epic name>.
Bound spine: <path or URL>
Bound issue: <URL or ledger row, if any>
Spine steward: <task/thread/agent>
Assignment identity: <stable task/thread/agent/owner>
Expected handoff: <what to update and report>
```

Authority by role:

| Role | Primary Job | May Edit | Must Not Do | Raise Hand When |
|---|---|---|---|---|
| Epic 0 worker | Keep the full project picture and spin out child spines/workers | Bound Epic 0 spine, child-spine drafts, coordination issues | Mutate child implementation detail without authority | Child scope conflicts, project direction changes, or human decision is needed |
| Planner | Shape intent, scope, backlog, dispatch | Bound spine planning sections, issue board | Implement code by default | Work needs product/scope decision or multi-spine edit |
| Epic worker | Act as delivery lead for scoped epic through issue/subagent loop | Bound spine as steward, GitHub issues, dispatch and integration state | Change acceptance, product intent, or cross-spine scope without input | Epic is ready for human test, or a required decision blocks delivery |
| Ticket worker | Execute one bound ticket | Issue branch/code, issue comments, PR, structured handoff | Rewrite the spine, mission, acceptance, or broad architecture unless explicitly delegated | Code/issue/spine diverge, blocker changes scope |
| Tester | Validate against acceptance | Test evidence, issue comments, structured handoff | Change implementation code or shared spine state by default | Acceptance is unclear, failure implies scope or design change |
| Reviewer | Inspect and advise | Findings only unless promoted | Mutate docs/issues/code | Finding requires owner decision |
| Observer | Bootstrap and summarize | Nothing unless promoted | Mutate docs/issues/code | Binding is unclear |

If no role is supplied, default to observer until the user or spine clearly binds the agent.

## Goal-Seeking Persistence

EpicSpine work should converge on a role-specific terminal state.

| Role | Goal | Continue Until | Stop / Escalate When |
|---|---|---|---|
| Epic 0 worker | Keep the project coherent | Child spines are mapped, state is rolled up, workers are bound, next actions are clear | Project direction, cross-child conflict, or human decision is required |
| Planner | Make the epic executable | Backlog is coherent, issues are ready, owners dispatched, blockers named | Product/scope decision, cross-spine authority, or user input is required |
| Epic worker | Deliver the scoped epic | Issues are created, subagents dispatched, fixes coordinated, and the epic is ready for human test or tester handoff | Product/scope decision, acceptance change, cross-spine authority, or human input is required |
| Ticket worker | Complete the bound issue | Implementation is ready for testing with PR/branch/evidence linked | Blocker changes scope, acceptance is unclear, or credentials/approval are required |
| Tester | Prove pass/fail | Acceptance passes, a bounded fix loop passes, or failure is evidenced | Failure implies scope/design/acceptance change or cannot be fixed locally |
| Reviewer | Surface risks | Findings are linked and prioritized | Mutation is needed; request role promotion |
| Observer | Bootstrap state | Current state and next action are clear | Binding is unclear |

Epic 0 workers should not stop after first coordination friction. They should keep reading child spines, rolling up state, creating child spines, binding child workers, and updating the root spine until the project has clear next actions or is blocked by a human decision.

Epic workers should not stop after first coordination friction. They should keep converting current state into issues, dispatching subagents, reconciling results, and updating the spine until the epic is ready for human test, ready for tester handoff, or truly blocked.

Ticket workers should not stop after first implementation friction. They should keep implementing, running relevant checks, and updating the issue until ready for testing or truly blocked.

Subagent write discipline:

- Epic workers write to the bound spine.
- Epic 0 workers write to the root/project spine and create or propose child spines.
- Ticket workers/subagents write deep detail and their final structured handoff to the assigned GitHub issue.
- Testers write exact commit/environment evidence to the issue and return a structured result.
- The active steward alone reconciles the spine unless a narrow section is explicitly delegated.
- The bound spine receives only clean state: issue links, PR/branch links, blockers, decisions needed, validation evidence, and next action.
- If a subagent needs a decision outside its issue, it raises it in the issue; the epic worker summarizes the durable consequence in the spine.

Testers may run a bounded self-fix loop when the failure is small and clearly inside the existing ticket. Preferred sequence:

1. Record the failing evidence in the issue.
2. Dispatch or request a worker/subagent fix with the same bound spine and issue.
3. Retest the fix.
4. Update the spine only with the durable result: pass/fail, evidence, residual risk, and next action.

Do not use tester self-fix for product decisions, broad refactors, architecture changes, unclear acceptance, or cross-spine changes. Escalate those to the planner.

## GitHub Issue Board Flow

Use GitHub issues as the board for executable work. The spine remains the authoritative coordination record for the epic.

Default location contract:

- Spine documents live in the repository, usually under `docs/`, unless the spine declares another location.
- GitHub issues live in the same repository as the bound spine unless the spine declares another issue repository.
- One active Issue Ledger row should map to one GitHub issue.
- GitHub Projects may be used as views, but they are not authoritative for epic intent or acceptance.
- PRs and branches are implementation evidence; link them from both the issue and spine ledger.

An epic worker may create and dispatch tickets inside already accepted scope. The planner owns changes to intent, acceptance, cross-epic structure, or decomposition that materially changes the approved plan.

## Branch, Worktree, And Integration Model

Use dedicated branches plus worktree isolation for parallel workers, and keep the integration line fresh.

- **One ticket worker = one issue = one dedicated branch and worktree**. The worker's first action is `git worktree add ../wt-<ticket> -b <branch> <pinned-base>`; record the absolute path. The primary clone stays pinned to integration and read-only. Checkout/switch there is a branch-ransom defect.
- Use branch names that identify the issue or role, for example `epic-2.4/c-3-checkout` or `issue-671-cloud-checkout`.
- Use a separate worktree for each concurrent agent that needs independent filesystem state. A worktree normally checks out the dedicated issue branch; it does not replace the branch.
- Record branch, worktree when used, base commit SHA, integration target, owner, and latest verified time at dispatch.
- Protected `main` is the default integration and deployment base unless the spine declares another branch.
- Merge small work frequently after required review and automated checks pass. New agents should bootstrap from the freshest validated integration base, not a stale long-lived branch.
- If work cannot merge, keep the issue ledger and GitHub issue explicit: branch, PR, blocker, owner, and next action.
- Prefer small PRs that can merge independently over large hidden branches.
- Human test should run from merged `main`, a named integration branch, or an explicit PR preview recorded in the spine. Always record the tested commit and environment.

Integration gates:

| Status | Required Meaning |
|---|---|
| `review` | Implementation complete, PR open, and required automated checks passing |
| `testing` | Exact commit available in the named test surface; acceptance validation in progress |
| `done` | Acceptance passed, evidence linked, residual risk recorded, spine reconciled |

The purpose is not ceremony. It prevents each worker's branch from becoming private state that future agents cannot see.

Planner flow:

1. Reconcile the spine Issue Ledger against GitHub issues.
2. Create missing issues from `assets/github-issue-template.md`.
3. Update stale issue titles, bodies, labels, dependencies, or acceptance criteria when they disagree with the bound spine.
4. Add issue links back into the spine ledger.
5. Identify tickets that can run in parallel:
   - no dependency between them;
   - no expected write conflict in the same files, services, migrations, or release surface;
   - acceptance criteria can be validated independently;
   - each worker can complete with only its issue plus the bound spine bootstrap map.
6. Dispatch workers with explicit bound spine, steward, assignment identity, dedicated branch, base commit, integration target, write scope, required reads, acceptance criteria, human gates, and handoff requirements.
7. Record dispatch state in the spine so a later planner can see which worker owns which issue.

Planners dispatch the initial plan. Epic workers may dispatch or re-dispatch parallel batches inside accepted scope; they must return scope or acceptance changes to the planner.

## Execution Cursor

Current State is the compact phase snapshot. The Execution Cursor is the durable resume point for the next execution cycle. Update it whenever work is attempted, execution stops, ownership changes, or a gate is reached.

The cursor must answer:

| Field | Question |
|---|---|
| Last attempted | What concrete action did the previous cycle try? |
| Result | What actually happened, and where is the evidence? |
| Execution status | Is work not-started, ready, active, blocked, in review, testing, or done? |
| Waiting on | Which person, decision, dependency, check, or event must move? |
| Approved work | What may proceed without another process-design or planning conversation? |
| Next action | What exact action should a new bound agent take first? |

The cursor is not a prose work log. Preserve only the latest durable resume state and link to the issue or handoff containing detail. Append historical consequences to Decisions or Handoff Journal when they matter beyond the next cycle.

At the end of an execution cycle, report the same shape to the user: what worked, what is stuck, what is waiting, what remains approved, and what happens next.

## Decision Memory And Rejected Paths

Decisions prevent future agents from repeatedly reopening settled paths. Before proposing a familiar approach, search the bound spine and relevant ancestors for `rejected` and `superseded` entries.

Use these outcomes:

- `accepted`: current operating choice;
- `rejected`: tried or evaluated and deliberately declined;
- `superseded`: once valid but replaced by a later choice.

A rejected or superseded entry contains:

- the approach or claim in a searchable phrase;
- a compact durable reason;
- a link to detailed evidence such as an issue, PR, ADR, experiment, or source memory;
- the condition that would justify reconsideration, or `never`.

Keep the anti-repetition fact in the spine even after linked implementation detail becomes historical. Do not paste the full investigation into the spine.

## Human Gates

Declare which actions require human approval. At minimum, consider:

- product intent or acceptance changes;
- production deployment;
- destructive migrations or data deletion;
- credentials, secrets, or privileged access;
- irreversible external actions;
- final experiential acceptance that automation cannot prove.

When blocked, the thread's entire next message is `BLOCKED ON <HUMAN>: <one exact question + options + recommendation>` and the thread stops. Do not polish adjacent work while parked.

## Sprint Dialect v2

New sprint spines use bounded, observable, human-verifiable increments: exactly two DoD tiers (a 5–12 step live-browser SHIP journey and deferred HARDEN), PORT/DUPLICATE/BUILD markings after an all-repo/service inventory, 90-minute ticket budgets, 30-minute heartbeats, pinned per-wave bases, manager-owned final journey loops, pre-answered Decisions with absence-rules, and paste-ready dispatch prompts built from `assets/dispatch-prompt-preamble.md`. Existing v1 spines remain backward compatible; missing v2 contracts warn rather than invalidate them.

A blocked handoff must name the decision, human owner, evidence, exact input required, and what can continue independently. Do not use `human required` as a complete blocker.

## Recovery And Takeover

Make assignments resumable. Every active issue should expose:

- stable assignment identity and owner;
- bound spine and active steward;
- branch, worktree if used, base commit, and latest commit;
- integration target and PR;
- last verified absolute time;
- blocker and exact next action.

When an assignment becomes stale or abandoned:

1. Verify the issue, branch, PR, code, and latest evidence.
2. Mark the old assignment `superseded` or otherwise visibly inactive; do not erase its history.
3. Record the takeover identity, starting commit, and any untrusted or unverified work.
4. Re-dispatch from the freshest safe base and reconcile the issue ledger.
5. Notify the spine steward, or assume stewardship only through an explicit transfer.

## Document Invariants

An EpicSpine is healthy when:

- A new teammate can identify the next action within five minutes.
- A new teammate can understand the intent and state without reading deep issue discussion.
- The spine declares a stable ID, type, root, and parent; every branch is reciprocally registered by its direct parent.
- The canonical hierarchy has no cycles or orphans; additional roots are explicitly justified.
- Direct-child rollups expose current status, health/blocker, evidence, last-rollup time, and next action without copying child detail.
- The Execution Cursor makes the last attempt, actual result, waiting condition, approved work, and next action unambiguous.
- The issue ledger and GitHub issue state agree, or drift is explicitly flagged.
- The write-scope boundary is explicit enough that an agent knows what it may edit.
- Exactly one active steward is named for each writable spine.
- Every active ticket has assignment identity, owner, branch, base commit, role, status, acceptance, latest verified time, evidence, and next action.
- Every major decision has date, rationale, and evidence.
- Rejected and superseded approaches remain searchable and say when reconsideration is warranted.
- Every validation claim links to a command, artifact, review, screenshot, or explicit manual check.
- The bootstrap map separates mandatory reads from conditional reads.

## Status Vocabulary

Use these statuses unless a repository already has its own vocabulary:

- `draft`: proposed but not ready for execution.
- `ready`: scoped and ready for the owning role.
- `active`: currently being worked.
- `blocked`: cannot progress without named input or dependency.
- `review`: implementation is complete, PR is open, and required automated checks pass.
- `testing`: the exact commit is available in a named test surface and acceptance validation is in progress.
- `done`: accepted against criteria, evidence is linked, and durable state is reflected in the spine.
- `superseded`: an assignment was replaced; preserve its history and point to the takeover.
- `deferred`: intentionally postponed.

## Issue Ledger Columns

- `Issue`: GitHub issue link or `draft`.
- `Role`: planner, worker, or tester.
- `Owner`: stable assignment identity or responsible human.
- `Title`: short executable ticket name.
- `Status`: one status from the shared vocabulary.
- `Depends On`: issue links or prerequisites.
- `PR/Branch`: implementation pointer, if any.
- `Base`: base commit SHA used for the assignment.
- `Acceptance`: compact ticket acceptance target.
- `Latest Evidence`: newest relevant proof, command, artifact, or comment.
- `Last Verified`: absolute date/time of the latest trusted reconciliation.
- `Next Action`: one concrete next step.

## Clean-Spine Discipline

Agents must keep the spine readable as the epic's operating surface.

Do include:

- concise current state;
- a precise execution cursor;
- direct-child rollups and canonical lineage;
- active spine steward and last reconciliation point;
- durable accepted, rejected, and superseded decisions with evidence;
- acceptance criteria and scope changes;
- dependency and blocker summaries;
- links to issues, PRs, commits, commands, screenshots, and artifacts;
- final validation result and residual risk.

Do not include:

- raw debug transcripts;
- long command output;
- copied diffs;
- exploratory implementation notes;
- back-and-forth issue discussion;
- detailed blocker investigation that belongs to one ticket.

Use this compression rule: if a detail helps only the current ticket worker, keep it in the issue; if it changes how future agents understand the epic, summarize it in the spine.

## Update Discipline

Use a three-pass update:

1. Update local execution truth: Current State, Execution Cursor, Issue Ledger, Validation Evidence.
2. Append durable history: Decisions, Handoff Journal, Open Questions.
3. Publish the compact child rollup to the parent steward when phase, health, blocker, evidence, or next action changed.

Prefer small edits. Do not rewrite old history unless correcting a factual error; if correcting, note the correction date.

## Drift Handling

When the bound spine conflicts with GitHub issues, PRs, or code:

1. State the conflict plainly.
2. Identify the freshest evidence by timestamp and source.
3. Use the authority-by-artifact contract to decide which fact each surface owns.
4. Have the steward update the spine if the correct durable state is clear.
5. If unclear, record an Open Question and stop before making irreversible execution changes.

When a referenced read-only spine appears stale:

1. Do not edit it directly.
2. Record a proposed cross-spine update in the bound spine.
3. Include the target spine, exact section, proposed text or summary, evidence, and suggested owner.
4. Link or create an issue for that target spine if the repository uses GitHub issues for coordination.

## Handoff Quality Bar

A handoff is complete when the next role can answer:

- What changed?
- Why did it change?
- What was attempted, and what actually happened?
- What is the next action?
- What is waiting, and what work remains approved?
- How will success be verified?
- What risks or open questions remain?
