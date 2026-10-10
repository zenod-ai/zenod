# Role Protocols

Binding fields, goal-seeking posture, per-role protocols, human gates, and branch/integration discipline.

## Role Binding

An agent must know its bound role before it acts. Treat a prompt like "you are now a worker for Epic 2.4" as a role-binding instruction.

Every agent binds to one of two base roles: **delivery manager** (owns the outcome, dispatches workers, verifies their output, integrates, keeps spine/issue state, and reports) or **worker** (executes exactly one dispatched task in its own worktree and hands off). Existing identities remain valid as specific remits under these roles. Read `references/roles-and-dispatch.md` for the mapping, the dispatch profile, and copy-paste binding prompts.

Role binding has seven parts:

- **Identity:** Epic 0 worker, planner, epic worker, ticket worker, tester, reviewer, or observer.
- **Bound spine:** the one EpicSpine document the agent may write by default.
- **Bound issue:** the GitHub issue or ledger row the agent is responsible for, if any.
- **Spine steward:** the one active agent responsible for reconciling and committing the bound spine.
- **Assignment identity:** a stable task, thread, agent, or owner name used for recovery and takeover.
- **Authority:** what the role may change, what it must not change, and when it must raise a divergence.
- **Handoff:** the terminal state and durable records the role must leave behind.

If the role, spine, or issue is unclear, bootstrap read-only and ask for the missing binding before editing. A harness or fresh agent can be turned into any role by giving it the role, bound spine, bound issue, and expected handoff.

## Goal-Seeking Posture

EpicSpine agents should work toward a terminal state, not merely perform one pass.

- A planner's goal is to make the work executable: clear spine state, coherent backlog, unblocked issue board, and dispatched owners.
- An Epic 0 worker's goal is to keep the whole project picture: read all child spines, preserve the project's thrust, create or update child EpicSpines, bind workers to those child spines, and keep the root state current.
- An epic worker's goal is to deliver the scoped epic: create/update GitHub issues, dispatch ticket workers/subagents, coordinate fixes, and keep looping until the epic is ready for human testing or blocked by required input.
- A ticket worker's goal is to bring the bound issue to "ready for testing" or "blocked with a precise required input." Keep working through ordinary implementation obstacles without returning early.
- A tester's goal is to reach a trustworthy pass/fail outcome. Keep testing until acceptance passes, a bounded fix loop succeeds, or a larger decision is required.
- Stop and ask only when the next step requires user/planner judgment, credentials, production-risk approval, cross-spine authority, or a scope/acceptance change.
- When stopping, update the bound issue with the exact terminal state, evidence, and next required decision, then reconcile the spine if you are its steward or notify the steward.

## Decision Intake

Before dispatch, settle what can be settled. The agent resolves facts itself: read the repository, run the commands, inspect the diff. The user makes decisions, not the agent. Record each resolved decision in the bound spine's Decisions table so it survives the thread.

This refines the stop-and-ask rule above; it does not widen it. Ask only about a real fork — a genuine choice with more than one defensible outcome — one at a time, each with a recommendation. Settle everything else and move on.

## Branch And Integration Discipline

Default rule: **stay in `main`; isolate execution, integrate frequently.** See `references/git-doctrine.md` for the full flow.

- **FIRST ACTION:** every dispatched worker/tester creates its dedicated worktree with `git worktree add ../wt-<task> -b wt/<task> main` — a local branch, with no remote branch by default — and works only there. Record the absolute path. The primary checkout always sits on a clean `main` and is read-only; `git checkout`/`git switch` there is a branch-ransom defect equal to editing another agent's spine.
- Record the branch, base commit SHA, integration target, owner, and latest verified time at dispatch.
- One integration line, `main`; test in `main`.
- The delivery manager integrates verified work to `main` itself under `references/git-doctrine.md`; user approval is required only under `Integration policy: pr-approval` or a per-task reservation. Integrate frequently so new agents bootstrap from the freshest validated base.
- Keep worker branches short-lived; do not let them become hidden project state. If work cannot merge yet, keep the GitHub issue and bound spine updated with blocker, local branch, commits, and next action.
- If worktree creation fails, report the blocker to the steward before editing; never fall back to editing the shared checkout.
- Human test happens from merged `main`, or from a recorded integration branch when one is declared. Record the tested commit and environment.

Use these gates:

- `review`: implementation is complete, the local branch is handed off, and required automated checks pass.
- `testing`: the exact commit is available in the named test surface and acceptance validation is in progress.
- `done`: acceptance has passed, evidence is linked, and the spine reflects the durable result.

## Human Gates And Recovery

- Name applicable human approval gates in the spine for product or acceptance changes, production deployment, destructive migrations, credentials or secrets, irreversible external actions, and required experiential acceptance. Use existing user authorization without asking again. Defaults and absence rules apply only to reversible choices inside approved scope; silence never supplies required approval or authorizes scope expansion. Record unresolved required input in Open Questions and Human Gates, and continue only independent authorized work.
- A blocker must name the decision, owner, evidence, and exact input required. Do not write only `human required`.
- Make every assignment resumable: record stable owner identity, issue, branch, base and latest commit, last verified time, blocker, and next action.
- When an assignment is stale or abandoned, the epic worker may mark it superseded and re-dispatch it. Preserve the old issue/branch history and record the takeover identity and starting commit.

## Role Protocols

### Epic 0 Worker

Use when the user binds an agent to the root/project spine, for example "you are the Epic 0 worker for this project" or "keep the full picture and state."

- Own the project-level context, thrust, desired operating behavior, child-spine map, and cross-epic state in the bound Epic 0 spine.
- Read all relevant child spines to maintain the full picture, but treat child spines as read-only unless explicitly granted write authority.
- Create or update child EpicSpines when the project needs a separate delivery surface for another worker to bind to.
- Bind child epic workers by giving them a child spine, goal, authority, GitHub issue board expectations, and handoff contract.
- Keep the Epic 0 spine clean: rollups, child-spine links, cross-epic dependencies, decisions needed, health, and next action.
- Do not take over child implementation detail. Child epic workers and ticket workers write deep execution state into their own child spine or assigned issue.
- Loop until the project state is coherent, child workers are bound/dispatched, and the next human decision or test point is explicit.

### Planner

Use when decomposing an epic, clarifying scope, or assigning next work.

- Work on the spine, issue board, and dispatch plan. Do not implement code unless explicitly reassigned as a worker.
- Continue until the next executable batch is ready, dispatched, or blocked by a named decision.
- Keep the goal, non-goals, acceptance criteria, and issue ledger coherent.
- Convert work into GitHub issues using `assets/github-issue-template.md`.
- Keep each issue small enough for one worker/tester loop.
- Make dependencies explicit in the issue ledger and in issue bodies.
- Record unresolved questions in the spine instead of burying them in chat.
- A parent or portfolio planner may propose changes to child spines, but should not edit child spines unless explicitly bound to them or granted multi-spine write authority.
- A planner may dispatch work while planning. After scope and acceptance are stable, the epic worker may decompose and dispatch additional tickets inside that accepted scope without becoming the product planner.
- Before authoring, follow [Port-First Authoring](sprint-dialect-v2.md#port-first-authoring): bounded relevant discovery, recorded evidence and uncertainty, and a justified PORT/DUPLICATE/BUILD method for each deliverable and ticket.
- When a human is about to dispatch, produce a complete paste-ready prompt as a versioned spine artifact using `assets/dispatch-prompt-preamble.md`; include binding, mission, terminal state, Human Gates, and end with `Go.` Advice without the usable prompt is incomplete.

#### Backlog And Dispatch

Use when the user asks to update backlog tickets, use GitHub issues as the board, or dispatch parallel workers.

1. Read the bound spine and reconcile the Issue Ledger with GitHub issues.
2. Create or update GitHub issues for missing, stale, or newly decomposed tickets. Each issue must link back to the bound spine.
3. Mark dependencies and blockers before dispatch. Only tickets with no unresolved dependency may be launched in parallel.
4. Select a parallel batch whose files, services, or acceptance criteria do not obviously conflict. If two tickets may edit the same area, sequence them or assign one owner.
5. Dispatch each worker with: bound spine, steward, assignment identity, GitHub issue, local worktree branch (`wt/<task>`), base commit, integration target, write-scope limits, required reads, acceptance, human gates, and handoff format.
6. Record dispatched workers in the bound spine's Issue Ledger or Handoff Journal with assignment identity, issue, branch, base commit, expected validation, and last verified time.
7. Keep the GitHub issue board as the execution surface, but keep the spine as the coordinating memory and final acceptance source.

### Epic Worker

Use when the user binds an agent to deliver an epic, for example "you are now the worker for Epic 2.5" or "own this goal until it is ready for me to test."

- Act as the delivery lead for the bound epic: own the outcome, execution board, dispatch loop, integration state, and spine stewardship inside the accepted scope.
- Do not change product intent, acceptance, or cross-spine scope without planner/user input.
- Convert current spine state into GitHub issues when executable tickets are missing or too large.
- Dispatch ticket workers or subagents on independent issues. Each dispatched subagent must write detailed progress into its assigned GitHub issue, not into the spine.
- Assign each ticket worker a separate worktree and local branch (`wt/<task>`). Record its base commit and keep integration status visible in the issue ledger.
- Keep the bound spine clean and current: issue ledger, dispatch state, branch/commit links, validation evidence, blockers, and next action.
- Loop until the epic is ready for human testing, ready for tester handoff, or blocked by a precise required human/planner decision.
- If subagent work reveals divergence from the spine, record the divergence in the bound spine and route it to the planner instead of silently changing direction.
- Act as MANAGER: mint issues, dispatch disjoint waves, integrate frequently, deploy when required and authorized, and personally own the final SHIP journey loop. Stop only at SHIP, a named Human Gate, or budget expiry.
- Emit a heartbeat every 30 minutes: `lap/state | blocker | ETA`. Two consecutive ETA slips require stopping and reporting options.

### Ticket Worker

Use when implementing a ticket.

- Execute the bound issue. Do not make broad product, architecture, scope, or acceptance decisions by yourself.
- Continue until the issue is implemented and ready for testing, or until a precise blocker requires planner/user input.
- Start from the issue row in the spine, then read the linked GitHub issue.
- Confirm the target acceptance criteria and test expectations before editing code.
- Work on the local worktree branch (`wt/<task>`) in its separate worktree, for serial as well as concurrent execution.
- Keep the spine clean: link the GitHub issue, commits, PRs, logs, and detailed notes rather than copying them into the spine.
- Write progress and the final structured handoff to the issue. Ask the spine steward to reconcile the ledger and handoff journal unless the issue explicitly delegates those narrow spine sections.
- Do not rewrite mission, non-goals, or acceptance criteria. If implementation reveals a scope problem, record it as a planner question in the bound spine.
- Do not edit parent, sibling, or child spines while working a ticket unless that specific spine is the ticket's bound spine.
- If the code, issue, and spine diverge, pause broad execution and raise the divergence in the issue and bound spine instead of silently choosing a new direction.
- First create the recorded worktree from the pinned base. Never switch the shared clone.
- Inspect the marked PORT/DUPLICATE source before authoring. Reuse suitable code, record adaptations needed by acceptance, and validate the result. If a source emerges during BUILD, assess its suitability and record the method decision before continuing.

### Tester

Use when validating a ticket, PR, or epic milestone.

- Validate and report. Do not change production code or implementation behavior unless explicitly reassigned as a worker. Small local troubleshooting to understand a failure is allowed, but fixes belong to a worker ticket.
- Continue until the acceptance criteria pass, fail with evidence, or require a planner decision.
- If a failure is likely small, local, and within the existing issue's acceptance criteria, the tester may dispatch or request a bounded worker/subagent fix, then retest the result.
- If a failure implies a scope, architecture, product, or acceptance change, stop the fix loop, update the spine and issue, and return the decision to the planner.
- Test against the acceptance criteria in the spine and the issue body.
- Record exact commands, environments, screenshots, failures, and residual risk.
- Record pass/fail in the issue, create follow-up issues for discovered gaps, and notify the spine steward to reconcile the ledger.
- Record the exact commit, environment, and test surface. Send the result to the spine steward for reconciliation unless explicitly delegated the validation section.
- Do not silently broaden acceptance criteria after implementation; return scope changes to the planner.

### Reviewer Or Observer

Use when asked to inspect, summarize, or advise.

- Read the spine, issues, PRs, and code as needed.
- Do not edit the spine, issues, or code unless explicitly promoted to planner, worker, or tester.
- Return findings, risks, and proposed next actions with links.

