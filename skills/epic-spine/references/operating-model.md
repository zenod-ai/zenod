# EpicSpine Operating Model

Read this when creating a new EpicSpine from scratch, repairing an inconsistent spine, or changing the planner/worker/tester workflow.

## Prior Art

EpicSpine combines spec-driven development (the spec is the durable source of truth), RFC/design-doc culture (intent, tradeoffs and dependencies before implementation), ADRs (decisions survive the discussion), working-backwards PR/FAQ (start from the user-visible outcome) and issue-tracked execution. The distinctive rule: the epic document stays the clean bootstrap artifact and durable memory; issues are synchronized execution records where deep ticket detail can live.

## Connected Spine Hierarchy

The canonical ownership tree, additional roots and their rationale, one parent per spine and stable Spine IDs are in `spine-model.md` (Connected Spine Model). A document is not a child merely because it links to another spine.

### Cold Start And Navigation

The repository should provide a small start-here pointer, often in `AGENTS.md`, that sends an agent to the canonical root. That router is not a second project-state document.

Cold-start order:

1. Read the root spine.
2. Read its direct-child rollups and follow the active or relevant branch.
3. Repeat until the work's bound spine is reached.
4. Read the bound spine's Current State, Execution Cursor, Decisions, Issue Ledger, and required bootstrap links.
5. Reconcile GitHub and the integration branch before execution.

This is the formal version of a useful resume instruction such as `continue`: the word itself contains no hidden project context; it means resume from the recorded cursor after verifying current execution reality.

## Spine Creation, Registration And Rollups

The creation protocol, registration (both directions land together, else `draft` + `registration pending`) and the direct-child rollup fields and rules are in `spine-creation.md` (Spine Creation And Registration, Rollup Contract).

## Write Scope

Authority by artifact, the spine/issue boundary, the bound spine, the active steward and "read broadly, write narrowly" are in `spine-model.md` (Authority By Artifact, Write Scope, Spine Versus Issues); "Authority by role" below gives the role defaults.

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
| Ticket worker | Execute one bound ticket | Worktree branch/code, issue comments, commits, structured handoff | Rewrite the spine, mission, acceptance, or broad architecture unless explicitly delegated | Code/issue/spine diverge, blocker changes scope |
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
| Ticket worker | Complete the bound issue | Implementation is ready for testing with local branch/commit evidence linked | Blocker changes scope, acceptance is unclear, or credentials/approval are required |
| Tester | Prove pass/fail | Acceptance passes, a bounded fix loop passes, or failure is evidenced | Failure implies scope/design/acceptance change or cannot be fixed locally |
| Reviewer | Surface risks | Findings are linked and prioritized | Mutation is needed; request role promotion |
| Observer | Bootstrap state | Current state and next action are clear | Binding is unclear |

Workers do not stop at first friction: Epic 0 and epic workers keep reading, rolling up, creating spines or issues, dispatching and reconciling until the next actions are clear or a human decision blocks; ticket workers keep implementing and running checks until ready for testing or blocked.

Subagent write discipline: the active steward alone reconciles the bound spine (unless a narrow section is delegated) and records only clean state (links, blockers, decisions needed, evidence, next action); ticket workers and testers write detail and the structured handoff to their issue or step row, and raise a decision outside their ticket there for the epic worker to summarize.

Testers may run a bounded self-fix loop when the failure is small and clearly inside the existing ticket. Preferred sequence:

1. Record the failing evidence in the issue.
2. Dispatch or request a worker/subagent fix with the same bound spine and issue.
3. Retest the fix.
4. Update the spine only with the durable result: pass/fail, evidence, residual risk, and next action.

Do not use tester self-fix for product decisions, broad refactors, architecture changes, unclear acceptance, or cross-spine changes. Escalate those to the planner.

## Ticket Board Flow

The step row is the ticket (`spine-model.md`); a GitHub issue or local ticket file is optional, for a step that needs its own discussion (`ticket-backends.md`). The spine stays authoritative for intent and acceptance; GitHub Projects are views; PRs and branches are implementation evidence linked from the ledger. An epic worker may create and dispatch tickets inside accepted scope; the planner owns changes to intent, acceptance or decomposition.

## Branch, Worktree, And Integration Model

Worktrees, integration and rollback are in [Git doctrine](git-doctrine.md). Record branch, worktree path, base commit, integration target, owner and latest verified time at dispatch; record the tested commit and environment for human test runs.

Integration gates:

| Status | Required Meaning |
|---|---|
| `review` | Implementation complete, local branch handed off, and required automated checks passing |
| `testing` | Exact commit available in the named test surface; acceptance validation in progress |
| `done` | Acceptance passed, evidence linked, residual risk recorded, spine reconciled |

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
6. Dispatch workers with explicit bound spine, steward, assignment identity, local worktree branch (`wt/<task>`), base commit, integration target, write scope, required reads, acceptance criteria, human gates, and handoff requirements.
7. Record dispatch state in the spine so a later planner can see which worker owns which issue.

Planners dispatch the initial plan. Epic workers may dispatch or re-dispatch parallel batches inside accepted scope; they must return scope or acceptance changes to the planner.

## Execution Cursor

For a compact active spine, `Current State` is the single authoritative resume point. Required labels and the normalized API are in [Compact state](compact-state.md). Use one `Waiting on` value for the actual blocker/wait, with explicit `none` when clear; Phase is optional. Role queues and handoff summaries link to state or are labeled generated projections. Completed handoffs move to linked historical records; preserve rejected decisions, source evidence and stable navigation.

The following two-section shape describes legacy full spines. Keep overlaps consistent while awaiting a steward-reviewed migration; the validator reports disagreements instead of choosing a source.

Current State is the compact phase snapshot. The Execution Cursor is the durable resume point for the next execution cycle. Update it whenever work is attempted, execution stops, ownership changes, or a gate is reached.

The cursor holds the fields listed in `spine-creation.md` (Execution Cursor And Decision Memory): last attempted, result, status, waiting on, approved work, next action.

The cursor is not a prose work log. Preserve only the latest durable resume state and link to the issue or handoff containing detail. Append historical consequences to Decisions or Handoff Journal when they matter beyond the next cycle.

At the end of an execution cycle, report the same shape to the user: what worked, what is stuck, what is waiting, what remains approved, and what happens next.

## Decision Memory And Rejected Paths

Decisions prevent future agents from repeatedly reopening settled paths. Before proposing a familiar approach, search the bound spine and relevant ancestors for `rejected` and `superseded` entries.

Outcomes are `accepted`, `rejected` and `superseded`; a rejected or superseded entry carries a searchable phrase, a compact reason, an evidence link and the reconsideration condition or `never` (`spine-creation.md`).

Keep the anti-repetition fact in the spine even after linked implementation detail becomes historical. Do not paste the full investigation into the spine.

## Human Gates

Declare which actions require human approval. At minimum, consider:

- product intent or acceptance changes;
- production deployment;
- destructive migrations or data deletion;
- credentials, secrets, or privileged access;
- irreversible external actions;
- final experiential acceptance that automation cannot prove.

When blocked, report `BLOCKED ON <owner>: <exact required input>` with evidence and stop dependent work. Use existing user authorization without asking again. Defaults and absence rules apply only to reversible choices inside approved scope; silence never supplies required approval or authorizes scope expansion. Record unresolved required input in Open Questions and Human Gates, and continue only independent authorized work.

## Sprint Dialect v2

New sprint spines use bounded, observable increments. Declare `Spine dialect: v2` and `Acceptance surface: browser|cli|library|infrastructure|documentation` (choose one value). Use the primary surface and explicitly list any additional surfaces required by acceptance. Undeclared spines default to v1; strict validation enforces the selected dialect without imposing v2 contracts on legacy spines.

Use exactly two DoD tiers: a 5–12 step SHIP journey and deferred HARDEN. The epic worker personally executes the journey, dispatches a scoped fix at the first failure, prepares the updated surface, and restarts until a clean pass. Browser work requires a REAL browser on the LIVE deployment with per-step screenshots. CLI work records exact commands, inputs, exit codes and outputs; library work executes a consumer example and behavior checks; infrastructure work records authorized health/state probes; documentation work follows instructions and checks rendered artifacts, links and examples as applicable. Hand off exact commit, environment and evidence that the human can reproduce. Deploy only when required and authorized. Run appropriate checks and repeat when changes or failures warrant it.

Search the current repository and explicitly named relevant repositories/services, with a default 15-minute search budget. Record scope, queries/paths, findings, elapsed time, and inaccessible or unsearched areas. Expand only for a concrete dependency within authorized scope; record any revised budget. At expiry, choose a justified method with uncertainty recorded, or escalate if the missing evidence blocks safe progress. Never infer absence outside the searched scope. `PORT from <repo/path>` moves an existing implementation; `DUPLICATE from <working unit>` copies a proven unit; `BUILD (no suitable source found in recorded scope)` records a bounded search outcome. Inspect sources before authoring. Adapt beyond imports/config when requirements require it, recording why and validating the adapted behavior. If reuse is unsuitable, record the reason rather than forcing a transplant or silently rebuilding. Mark every deliverable and ticket with its justified method.

Retain 90-minute ticket budgets, 30-minute heartbeats, pinned per-wave bases, manager-owned final journey loops, pre-answered Decisions with safe absence rules, and paste-ready dispatch prompts from `assets/dispatch-prompt-preamble.md`. Use existing user authorization without asking again. Defaults and absence rules apply only to reversible choices inside approved scope; silence never supplies required approval or authorizes scope expansion. Record unresolved required input in Open Questions and Human Gates, and continue only independent authorized work.

A blocked handoff must name the decision, human owner, evidence, exact input required, and what can continue independently. Do not use `human required` as a complete blocker.

## Recovery And Takeover

Make assignments resumable. Every active issue should expose:

- stable assignment identity and owner;
- bound spine and active steward;
- branch, absolute worktree path, base commit, and latest commit;
- integration target and optional PR;
- last verified absolute time;
- blocker and exact next action.

When an assignment becomes stale or abandoned:

1. Verify the issue, branch, commits, code, and latest evidence.
2. Mark the old assignment `superseded` or otherwise visibly inactive; do not erase its history.
3. Record the takeover identity, starting commit, and any untrusted or unverified work.
4. Re-dispatch from the freshest safe base and reconcile the issue ledger.
5. Notify the spine steward, or assume stewardship only through an explicit transfer.

## Document Invariants

An EpicSpine is healthy when:

- A new teammate can identify the next action within five minutes.
- A new teammate can understand the intent and state without reading deep issue discussion.
- The spine declares a stable ID, type, root, and parent; every branch is reciprocally registered by its direct parent.
- Direct-child rollups expose current status, health/blocker, evidence, last-rollup time, and next action without copying child detail.
- The authoritative Current State (or reconciled legacy Execution Cursor) makes owner, last attempt/result/evidence, waiting condition, approved work, next action and verified revision/time unambiguous.
- The issue ledger and GitHub issue state agree, or drift is explicitly flagged.
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
- `review`: implementation is complete, the local branch is handed off, and required automated checks pass.
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

"Minimal epics" in `spine-model.md` rules. In short: keep the epic to its own level (goal, done means, state, steps, decisions, learnings, evidence links, final validation and residual risk); raw transcripts, long output, copied diffs, exploratory notes and one ticket's blocker detail go to a linked page or the issue.

## Update Discipline

Update local execution truth once in Current State (plus issue and acceptance evidence; legacy full spines keep overlapping cursor facts consistent until a reviewed migration), then append durable history (Decisions, Handoff Journal, Open Questions), then publish the compact child rollup to the parent steward when phase, health, blocker, evidence or next action changed. Prefer small edits; never rewrite old history except to correct a fact, and then note the date.

## Drift Handling

When the bound spine conflicts with GitHub issues, PRs, or code: state the conflict, identify the freshest evidence by timestamp and source, apply the authority-by-artifact contract, and have the steward update the spine if the durable state is clear; if unclear, record an Open Question and stop before irreversible changes. A stale read-only spine is never edited: record a proposed update in the bound spine (target spine, section, text, evidence, suggested owner) and link or create an issue for it.

## Handoff Quality Bar

A handoff is complete when the next role can answer: what changed and why; what was attempted and what actually happened; the next action; what is waiting and what work remains approved; how success will be verified; what risks or open questions remain.
