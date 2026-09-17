---
name: epic-spine
description: EpicSpine / Epic Spine document-centric operating system for AI-assisted software work. Use when asked to epicspine an epic, create, read, orient on, maintain, execute from, update backlog tickets for, or dispatch parallel workers from a living epic document that coordinates planner, worker, and tester agents; maps required context for fast bootstrap; tracks authority, GitHub issues, branches, PRs, decisions, acceptance criteria, handoffs, and validation evidence; or keeps a project/epic document authoritative for intent and coordination while issues are executable tickets.
---

# EpicSpine

## Overview

Use an EpicSpine as the clean thread of intent, desire, context, fit, and state for a scoped body of work. Treat the declared ticket backend as the execution board for specific steps, not as the place where the full project memory lives. GitHub remains the default; an explicit local backend uses authoritative ticket files.

The document must let a new planner, worker, tester, or reviewer start from near-zero context, follow the listed spine hierarchy and knowledge graph, and understand the epic's goal, current state, decision history, active work, acceptance criteria, and validation evidence.

## Active Profile And State

Use `assets/compact-spine-template.md` for a small active epic. Declare `Spine profile: compact`; keep one authoritative `Current State` with owner, status, last action/result/evidence, one waiting/blocker condition, approved work, exact next action, and verified source revision/time. Phase is optional context. Do not author another cursor, role queue or handoff summary containing competing current facts; use links or explicitly generated projections.

The compact profile requires Mission, Non-Goals, Current State, Definition Of Done, Issue Ledger and Decisions. Add hierarchy, recovery, write-scope gates and Book details when applicable. Stable ID, repository, document path and integration branch remain required. A standalone compact spine makes no hierarchy claim; `--graph` requires explicit lineage fields before it can validate connection.

Absent `Spine profile` or `Spine profile: full` retains legacy requirements. Legacy Current State/Execution Cursor documents remain readable; contradictory aliases produce source-located conflicts, never an inferred winner. Reconcile meaning as the steward before migration. Keep completed handoffs in linked history while preserving rejected decisions, evidence, IDs and old fragments. See `references/compact-state.md` for the normalized state API, conservative migration preview and history rules.

Profile and dialect are separate: compact v1 is a small structural contract; opt into v2 for its SHIP/HARDEN acceptance. The full template remains available for existing v1/v2 workflows and explicit legacy compatibility.

## Connected Spine Model

Treat every EpicSpine as a node in a canonical ownership hierarchy:

- Prefer one canonical root spine per repository or coherent project. Multiple roots are allowed only when they represent intentionally independent ambitions; record why each additional root cannot be a branch of the canonical root.
- Every non-root spine has exactly one canonical parent and inherits exactly one root. Parentage may nest to any depth.
- The canonical hierarchy is a rooted tree, or an explicitly justified forest when multiple roots exist. Cross-links may form a wider knowledge graph, but they do not change canonical parentage or rollup ownership.
- Every spine declares a stable Spine ID. Connected spines additionally declare Spine Type, Root Spine, and Parent Spine. A parent lists each direct child in its Spine Map; a child links back to its parent and root.
- A child owns its local mission, acceptance, execution state, backlog, decisions, and evidence. Its parent owns only the compact rollup, dependencies, health, and cross-child decisions.
- Roll up direct children one level at a time. Do not copy descendant issue ledgers or deep history into ancestors.

`AGENTS.md`, repository instructions, and launch prompts may route a cold start to the root spine. They must not duplicate live project state. The root spine is the canonical starting point; agents follow its active-branch links until reaching the spine bound to their work.

## Spine Versus Issues

Declare `Ticket backend: github|local` (omission defaults to github). GitHub mode retains the existing offline URL/status checks and clearly unverified ledger snapshots. Local mode declares `Ticket root`, uses a reference/dependency-only Issue Ledger, and puts Ticket ID, Status, Owner and Evidence in each authoritative ticket file. Never maintain both a mutable local ticket and copied status cells in its spine. Read `references/ticket-backends.md` for path boundaries, normalized records and verification semantics. No backend choice implies remote access, record migration or new read authority.

- The spine explains why the work exists, what outcome is desired, how the pieces fit together, what the current state is, and where a new agent should go next.
- GitHub issues explain the detailed work for one concrete step: code paths, blockers, implementation notes, logs, review comments, and ticket-level validation.
- Keep the spine clean. Prefer compact state, decisions, links, and evidence over long debugging transcripts or code-level detail.
- Put deep ticket discussion in the GitHub issue or PR, then summarize only the durable consequence back into the spine.
- If an issue discussion changes intent, scope, acceptance, dependency, or current state, write that change back into the bound spine.

## Authority By Artifact

Do not treat one artifact as authoritative for every kind of truth:

- The EpicSpine is authoritative for intent, scope, epic acceptance, dependencies, decisions, and rollup state.
- The declared backend record (GitHub issue or local ticket file) is authoritative for detailed execution state of one ticket; offline GitHub ledger values remain unverified snapshots.
- The branch, pull request, and code are authoritative for the implementation that actually exists.
- Validation evidence is authoritative for what has been proved in a named environment against a named commit.
- The Epic 0 spine is authoritative for project direction, child-spine relationships, and cross-epic health.

When a repository declares an active Book companion:

- The Book is authoritative for the navigable, user-facing body of accumulated knowledge and synthesis.
- When present, its canonical registry is authoritative for the current structured collection or shortlist rendered by the Book.
- Chapters organize domains and index their leaves; leaves own the substantive explanation, research, comparison, or conclusion for one bounded question.
- Evidence remains authoritative for the underlying claims. A polished Book leaf does not outrank current code, data, source documents, or validation.

The active spine steward reconciles contradictions. Never overwrite observable code or test evidence merely because the spine says something older.

## Optional Book Companion

The spine and the Book are complementary, not competing masters:

- **Spine:** why and how the work is being developed—objectives, scope, execution state, backlog, decisions, gates, and validation.
- **Book:** what has been learned or produced for the user—insights, explanations, research, comparisons, conclusions, and a current structured collection when one exists.

Activate Book behavior only when repository instructions or the root spine declare a Book root and contract. Once active, binding an agent to any spine in that repository also binds it as a Book author by default; the user should not need to request a leaf separately. Existing role and write-scope limits still apply.

For material research, option analysis, recommendation, reusable explanation, or substantial user-facing synthesis:

1. Read the Book root and relevant chapter before answering.
2. Update an existing leaf when it already owns the question; otherwise create one under the narrowest owning chapter.
3. Add reciprocal navigation: root to chapter, chapter to leaf, and leaf back to chapter and root. Directly promote the leaf at the root only when the Book contract classifies it as current or decision-significant.
4. Mutate the canonical registry only when the work changes the current structured collection, and only within declared write authority. Never maintain a second live shortlist in a chapter or leaf.
5. Keep chat concise and link the durable leaf, stating the knowledge delta.

Do not create a leaf for a quick answer, transient status, raw execution log, ticket-level debugging, or work with no durable user-facing knowledge. Do not create `v2`, `final`, or dated replacement roots; update stable nodes and use Git history. If the Book is not declared, continue with ordinary EpicSpine behavior rather than inventing one.

Read `references/book-companion.md` when installing, repairing, validating, or materially extending a Book, or when deciding where a knowledge-producing result should land. Use `assets/book-companion-contract.md` to declare the local paths and permissions.

## Role Binding

An agent must know its bound role before it acts. Treat a prompt like "you are now a worker for Epic 2.4" as a role-binding instruction.

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

## Name

Call the pattern **EpicSpine** in conversation. Use `epic-spine` for files, labels, branches, and skill references when a machine-friendly name is needed.

## Workflow

1. **Enter through the root.** Follow the repository's start-here pointer to the canonical root spine. If the user supplied a spine directly, verify its declared root and parent before treating it as bound.
2. **Follow the active branch.** Read direct-child rollups and follow only the active/relevant branch until reaching the spine whose mission contains the requested work.
3. **Create only when needed.** If no suitable spine exists, use the spine-creation protocol below and `assets/compact-spine-template.md` (or the explicit full legacy template when needed); do not create an orphan document.
4. **Establish write scope.** Identify the bound spine and its active steward. Treat root, parent, child, and sibling spines as read-only unless the user explicitly grants write authority or creation includes an atomic parent registration.
5. **Establish role binding.** Identify whether this agent is Epic 0 worker, planner, epic worker, ticket worker, tester, reviewer, or observer. Apply that role's authority limits before taking action.
6. **Build the bootstrap map.** Extract mission, non-goals, acceptance, the authoritative Current State, Issue Ledger, Decisions and required links; read hierarchy and legacy cursor only when present.
7. **Detect Book binding.** Read the repository's Book declaration, if active, then open the Book root and the chapter relevant to the task. Treat the binding as automatic; do not wait for a second user instruction.
8. **Reconcile execution state.** Inspect GitHub issues, PRs, branches, current code, and validation evidence only after the spine has oriented you. Resolve each fact using the authority-by-artifact contract and flag drift.
9. **Check durable memory.** Before proposing a recurring approach, search Decisions in the bound spine and relevant ancestors for rejected or superseded paths. If the Book is active, also search its chapters and leaves for an existing owner of the question.
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

## Write Scope

Default rule: **read broadly, write narrowly.**

- The agent's **bound spine** is the primary spine named by the user, issue, branch, or explicit task context. It is the only spine the agent may edit by default.
- Each spine must name one **active steward**. The Epic 0 worker normally stewards the root spine; the epic worker normally stewards a child spine; a planner may steward a spine during planning when explicitly bound.
- The steward reconciles and commits spine updates. Other agents write detailed state to their bound issue and submit a structured handoff unless explicitly delegated a narrow spine section.
- Do not let multiple agents concurrently rewrite mission, acceptance, current state, or the issue ledger. Transfer stewardship explicitly when the active writer changes.
- Referenced parent, child, sibling, portfolio, roadmap, or meta-spines are read-only context unless the user explicitly says the agent may edit that spine.
- If the agent notices drift in a read-only spine, record a proposed cross-spine update in the bound spine's Open Questions, Planner Queue, or Handoff Journal. Include the target spine, proposed change, evidence, and suggested owner.
- Do not update another spine just because the current work affects it. Create a GitHub issue, handoff note, or proposed update for that spine's planner.
- If a task genuinely requires editing multiple spines, state the requested write set before editing and keep each edit scoped to that spine's authority.

Use parent or portfolio spines for rollups, dependencies, health, and cross-epic decisions. Keep child spines authoritative for their own implementation state, validation evidence, and ticket ledger.

Normal rollup does not grant a parent steward authority to rewrite child detail. The child steward publishes the rollup or sends a structured proposal; the parent steward reconciles the parent row.

## Branch And Integration Discipline

Default rule: **isolate execution, integrate frequently.**

- **FIRST ACTION:** every dispatched worker/tester creates its dedicated worktree with `git worktree add ../wt-<ticket> -b <branch> <pinned-base>` and works only there. Record the absolute path. The primary/shared clone remains pinned to the integration branch and is read-only; `git checkout`/`git switch` there is a branch-ransom defect equal to editing another agent's spine.
- Record the branch, base commit SHA, integration target, owner, and latest verified time at dispatch.
- The shared integration line is protected `main` unless the bound spine declares another branch.
- Merge small, reviewed work after required checks pass. Integrate frequently so new agents bootstrap from the freshest validated base.
- Do not let long-lived worker branches become hidden project state. If work cannot merge yet, keep the GitHub issue and bound spine updated with blocker, branch, PR, and next action.
- If worktree creation fails, report the blocker to the steward before editing; never fall back to editing the shared checkout.
- Human test should normally happen from merged `main`, a recorded integration branch, or an explicit PR preview. Record the tested commit and environment.

Use these gates:

- `review`: implementation is complete, the PR is open, and required automated checks pass.
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
- Before authoring, follow Port-First Authoring below: bounded relevant discovery, recorded evidence and uncertainty, and a justified PORT/DUPLICATE/BUILD method for each deliverable and ticket.
- When a human is about to dispatch, produce a complete paste-ready prompt as a versioned spine artifact using `assets/dispatch-prompt-preamble.md`; include binding, mission, terminal state, Human Gates, and end with `Go.` Advice without the usable prompt is incomplete.

#### Backlog And Dispatch

Use when the user asks to update backlog tickets, use GitHub issues as the board, or dispatch parallel workers.

1. Read the bound spine and reconcile the Issue Ledger with GitHub issues.
2. Create or update GitHub issues for missing, stale, or newly decomposed tickets. Each issue must link back to the bound spine.
3. Mark dependencies and blockers before dispatch. Only tickets with no unresolved dependency may be launched in parallel.
4. Select a parallel batch whose files, services, or acceptance criteria do not obviously conflict. If two tickets may edit the same area, sequence them or assign one owner.
5. Dispatch each worker with: bound spine, steward, assignment identity, GitHub issue, dedicated branch, base commit, integration target, write-scope limits, required reads, acceptance, human gates, and handoff format.
6. Record dispatched workers in the bound spine's Issue Ledger or Handoff Journal with assignment identity, issue, branch, base commit, expected validation, and last verified time.
7. Keep the GitHub issue board as the execution surface, but keep the spine as the coordinating memory and final acceptance source.

### Epic Worker

Use when the user binds an agent to deliver an epic, for example "you are now the worker for Epic 2.5" or "own this goal until it is ready for me to test."

- Act as the delivery lead for the bound epic: own the outcome, execution board, dispatch loop, integration state, and spine stewardship inside the accepted scope.
- Do not change product intent, acceptance, or cross-spine scope without planner/user input.
- Convert current spine state into GitHub issues when executable tickets are missing or too large.
- Dispatch ticket workers or subagents on independent issues. Each dispatched subagent must write detailed progress into its assigned GitHub issue, not into the spine.
- Assign each ticket worker a dedicated branch and separate worktree. Record its base commit and keep merge status visible in the issue ledger.
- Keep the bound spine clean and current: issue ledger, dispatch state, PR/branch links, validation evidence, blockers, and next action.
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
- Work on the dedicated issue branch in its separate worktree, for serial as well as concurrent execution.
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

## Sprint Dialect v2 — Bounded Human-Verifiable Delivery

Use v2 when authoring a sprint with the SHIP/HARDEN workflow; a small compact epic may choose v1 explicitly. Declare `Spine dialect: v2` and `Acceptance surface: browser|cli|library|infrastructure|documentation` (choose one value). Use the primary surface and explicitly list any additional surfaces required by acceptance. Existing v1 spines remain readable and executable. Undeclared spines default to v1; strict validation enforces the selected dialect, not an implicit upgrade. A v2 spine is a budget for one observable increment, not a wish list for a perfect end state.

### Journey-First SHIP And HARDEN

- Definition Of Done has exactly two tiers. **SHIP** is one numbered observable journey of 5–12 steps on the declared acceptance surface. **HARDEN** lists work deferred until the human approves SHIP.
- The epic worker personally executes SHIP: run the journey → first failure → dispatch a scoped fix → prepare the updated surface → restart from step 1. Continue to one uninterrupted clean pass. Deploy only when the surface requires it and authorization covers it.
- For `browser`, use a REAL browser on the LIVE deployment with one screenshot per step. For `cli`, record exact commands, inputs, exit codes and outputs. For `library`, execute a consumer example and relevant behavior checks. For `infrastructure`, record authorized health/state probes and results in the named environment. For `documentation`, follow the instructions and inspect rendered artifacts, links and examples as applicable. No browser deployment or screenshots are required solely for non-browser work.
- Hand off a truthful test package: personally verified steps, exact commit, environment, commands/results or artifact checks, and remaining limits. Browser handoffs include the live URL and per-step screenshots. The human can reproduce the same journey against the same build or artifact. Never claim a step was exercised without doing it.
- Run checks appropriate to the change; automated checks support observable acceptance. Repeat them when new changes, failures or unresolved concerns justify it. Documentation examples and validation instructions may need execution even when only documentation changed.

### Port-First Authoring

- Search the current repository and explicitly named relevant repositories/services, with a default 15-minute search budget. Record scope, queries/paths, findings, elapsed time, and inaccessible or unsearched areas. Expand only for a concrete dependency within authorized scope; record any revised budget. At expiry, choose a justified method with uncertainty recorded, or escalate if the missing evidence blocks safe progress. Never infer absence outside the searched scope.
- Mark every SHIP deliverable and ledger row PORT, DUPLICATE, or BUILD with the source or recorded search evidence. Unmarked v2 work is invalid.
- `PORT from <repo/path>` moves an existing implementation; `DUPLICATE from <working unit>` copies a proven unit; `BUILD (no suitable source found in recorded scope)` records a bounded search outcome. Inspect sources before authoring. Adapt beyond imports/config when requirements require it, recording why and validating the adapted behavior. If reuse is unsuitable, record the reason rather than forcing a transplant or silently rebuilding.

### Pre-Answered Decisions And Traps

- Decisions is a required, stable-ID table (`D1`…`Dn`) that pre-answers domains, sequencing, pricing, credentials, and likely manager choices. Credential rules name existing authorized locations to read; reuse accessible credentials within existing authority and record any required access gate.
- Pre-answer routine choices with safe defaults and journal the decision. Use existing user authorization without asking again. Defaults and absence rules apply only to reversible choices inside approved scope; silence never supplies required approval or authorizes scope expansion. Record unresolved required input in Open Questions and Human Gates, and continue only independent authorized work.
- Carry newly discovered bug classes into the next sprint's Decisions table as a known-trap rule. Parent spines may declare a CANONICAL artifact with an owner and change rule.

### Bounded Observable Autonomy

- Every ticket has a budget (90 minutes by default). At expiry, report state/blocker/options; the manager reassigns any ticket silent past budget.
- Heartbeat every 30 minutes with exactly `lap/state | blocker | ETA`. Two consecutive ETA slips stop the thread and surface options.
- The first ledger ticket delivers the earliest observable increment on the declared acceptance surface. Hardening runs behind the demo. The phrase `no human in the loop` is banned.
- Human Gates name owner, trigger, exact input, and what may continue. When blocked, report `BLOCKED ON <owner>: <exact required input>` with evidence and stop dependent work. Continue only independent authorized work; do not treat elapsed time as approval.

### Pins, Waves, And Ceremony

- Pin the base commit at dispatch in Current State: `pinned; no rebases until the journey passes`. Each integrated wave explicitly re-pins. Full gates run once per pinned base; after two rebase-and-reprove laps, escalate rather than starting a third. Providers quiesce overlapping merges during a consumer's pinned proof.
- Group tickets into disjoint waves by file surface. Record wave membership. The journey loop is last and belongs to the epic worker personally.
- Scale ceremony by risk: live customer data gets snapshot, checksum, and one restore drill per mechanism per epic; dead/test/reversible assets get snapshot-and-go; docs get none.

### Status, Gates, And Supersession

- A gated spine begins `Status: pending — DISPATCH ONLY AFTER <condition>` and repeats the dispatch condition, blocker, and pin-at-dispatch rule in Current State. Do not mint, dispatch, or execute tickets before the condition passes.
- When superseding a spine, rewrite the old document's Status line in place to `SUPERSEDED by <path> — do not execute from this document`; use equally explicit `CLOSED` or `ON HOLD` redirects.
- Store worker dispatch prompts in the spine appendix. Each prompt includes the mission and standard operational preamble, complete bindings and Human Gates, and ends `Go.`

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
Branch: <dedicated branch>
Base commit: <SHA>
Integration target: <main or declared branch>
Required reads: <bootstrap map links>
Acceptance criteria: <issue and spine criteria>
Human gates: <named approvals or none>
Handoff: update the issue with PR/branch, latest commit, validation evidence, blocker, and next action; notify the spine steward to reconcile durable state.
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
Integration rule: every dispatched worker/tester uses a dedicated branch and separate worktree; merge small reviewed changes after required checks pass so new agents start from the freshest validated base.
```

## Resources

- Use `assets/epic-spine-template.md` when creating a new spine document.
- Use `assets/github-issue-template.md` when drafting planner-created tickets.
- Use `assets/book-companion-contract.md` when installing a Book declaration in repository instructions or a root spine.
- Start every paste-ready worker prompt with `assets/dispatch-prompt-preamble.md` and store the completed prompt in the spine appendix.
- Read `references/operating-model.md` when changing the workflow structure itself or when the existing spine is inconsistent.
- Read `references/book-companion.md` when installing, repairing, validating, or materially extending an active Book companion.
- Run `scripts/validate_spine.py <spine.md>` after creating or materially restructuring a spine. Use `--strict` for non-template project spines. Pass the affected local spine files together with `--graph` to check parent/root links, reciprocal registration, cycles, and multiple-root policy. Validation checks recorded structure and evidence, not remote GitHub truth.
