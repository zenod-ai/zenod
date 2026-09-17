# EPIC: <name>

<!-- Full legacy profile. Prefer compact-spine-template.md for small active epics;
keep overlapping Current State and Execution Cursor facts consistent until migration. -->

Spine profile: full
Ticket backend: github

Status: draft | ready | active | pending — DISPATCH ONLY AFTER <condition> | CLOSED | ON HOLD | SUPERSEDED by <path> — do not execute from this document
Created: YYYY-MM-DD
Updated: YYYY-MM-DD
Repository: <owner/repo or path>
Primary document: <link or path to this file>
Spine ID: <stable-id>
Spine Type: root | branch
Spine dialect: v2
Acceptance surface: browser | cli | library | infrastructure | documentation
Root spine: self | <root spine link>
Parent spine: none | <direct parent spine link>
Additional root rationale: n/a | <why this cannot be a branch of the canonical root>
GitHub issues: <owner/repo/issues or "same repository">
Integration branch: main
Active spine steward: <stable task/thread/agent>
Steward since: YYYY-MM-DD HH:MM TZ
Last reconciled commit: <SHA or n/a>
Planner: <name or agent/thread>
Worker: <name or agent/thread>
Tester: <name or agent/thread>

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | <task/thread/agent> | <project/root scope> | Steward root project state, child-spine map, rollups, dependencies, dispatch notes; create child spine drafts. | Root spine current, child workers bound, next human decision clear. |
| Planner | <task/thread/agent> | <epic scope> | Steward planning sections when explicitly bound; maintain issue board; do not implement code by default. | Updated ledger, decisions, dispatch notes, stewardship transfer if applicable. |
| Epic worker | <task/thread/agent> | <epic scope> | MANAGER: mint tickets, dispatch parallel worktree workers, integrate, deploy when required and authorized, walk the SHIP journey personally, and iterate until SHIP, a named Human Gate, or budget expiry. | Test package, ledger, blockers, tested commit/environment, next action. |
| Ticket worker | <task/thread/agent> | <issue URL or ledger row> | FIRST ACTION: `git worktree add ../wt-<ticket> -b <branch> <pinned-base>` and work only there; never checkout/switch in the shared clone. Inspect PORT/DUPLICATE sources and record required adaptations and their validation. | PR/branch, worktree path, latest commit, validation notes, blocker, next action in issue. |
| Tester | <task/thread/agent> | <issue URL, PR, or milestone> | Validate exact commit against acceptance; write issue evidence; no shared spine edits unless delegated. | Commit, environment, test method, result, risks, follow-up issues. |
| Reviewer | <task/thread/agent> | <scope> | Read and report findings; no mutation unless promoted. | Findings and proposed next actions. |

## Write Scope

Bound spine: <this document>
Active steward: <task/thread/agent>

Writable by default:

- The active steward reconciles and commits this spine.
- Other agents write detailed state and structured handoffs to their assigned GitHub issue.
- Explicit narrow delegation: <section + identity, or none>

Read-only linked spines:

- <parent, child, sibling, portfolio, or roadmap spine>

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Intent, scope, epic acceptance, dependencies, decisions, rollup state |
| GitHub issue | Detailed execution state for one ticket |
| Branch / PR / code | Implementation that actually exists |
| Validation evidence | What passed or failed for an exact commit in a named environment |
| Parent / Epic 0 spine | Project direction, spine relationships, cross-epic health |

## Spine Map

Canonical lineage: `<root-spine-id> -> <optional intermediate spine ids> -> <this-spine-id>`

List direct children only. A leaf spine may write `No child spines.` instead of keeping an empty table.

| Spine ID | Relationship | Spine | Purpose | Status | Health / Blocker | Latest Evidence | Last Rolled Up | Next Action |
|---|---|---|---|---|---|---|---|---|
| <child-spine-id> | child | <path or URL> | <one-sentence owned ambition> | draft | <healthy or exact blocker> | <link or none> | YYYY-MM-DD HH:MM TZ | <one concrete action> |

Cross-links that do not change canonical parentage:

- <related sibling, roadmap, memory, architecture, or portfolio link and why it matters>

## Mission

State the outcome in one paragraph. Write for a capable teammate who has not seen the chat history.

## Definition Of Done

<!-- See ../references/structural-validation.md for strict data checks and advisory prose. -->

SHIP — one observable journey with as many steps as the outcome requires on the declared Acceptance surface (choose one header value). The epic worker personally executes it: run → first failure → dispatch a scoped fix → prepare the updated surface → restart from step 1, until one uninterrupted clean pass. Deploy only when required and authorized.

Acceptance outcome: <observable result>
Evidence method: <selected surface>: <how the result will be exercised and recorded>

Evidence by surface: browser requires a REAL browser on the LIVE deployment and one screenshot per step; cli requires exact commands, inputs, exit codes and outputs; library requires a runnable consumer example and behavior checks; infrastructure requires authorized health/state probes in the named environment; documentation requires following instructions and checking rendered artifacts, links and examples as applicable. Run appropriate checks and repeat when changes or failures warrant it.

- [ ] 1. <first observable step> — PORT from <repo/path> | DUPLICATE from <working unit> | BUILD (no suitable source found in recorded scope)
- [ ] 2. <journey step> — PORT from <repo/path> | DUPLICATE from <working unit> | BUILD (no suitable source found in recorded scope)
- [ ] 3. <journey step> — PORT from <repo/path> | DUPLICATE from <working unit> | BUILD (no suitable source found in recorded scope)
- [ ] 4. <journey step> — PORT from <repo/path> | DUPLICATE from <working unit> | BUILD (no suitable source found in recorded scope)
- [ ] 5. Test package: personally verified steps, exact commit, named environment, commands/results or artifact checks, and remaining limits. For browser: live URL and per-step screenshots. Every handed-off element was exercised against this build or artifact; the human can repeat the same journey.

HARDEN — explicitly deferred until the human approves SHIP:

- [ ] <hardening item>

## Non-Goals

- <explicitly out of scope>

## Current State

Phase: planning | implementation | testing | blocked | complete
Last verified: YYYY-MM-DD HH:MM TZ
Integration target: main
Fresh base commit: <SHA>
Pinned-base rule: pinned; no rebases until the journey passes. Wave N re-pin: <SHA> — integrated prior wave, pinned.
Dispatch condition: <none, or exact gate for a pending spine>
Next action: <single next action>
Blockers: <none or list>

## Execution Cursor

Last attempted: <most recent concrete action, or none yet>
Result: <actual outcome plus evidence link, or not started>
Execution status: not-started | ready | active | blocked | review | testing | done
Waiting on: <person, decision, dependency, or nothing>
Approved work: <work that may proceed without another planning turn, or none>
Next action: <one exact resumable action>

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Epic 0 worker | Keep the full project picture and child-spine system coherent. | Child spines mapped, state rolled up, workers bound, or human decision required. |
| Planner | Make the work executable and dispatched. | Backlog ready/dispatched or named blocker. |
| Epic worker | Deliver the scoped epic through GitHub issue/subagent loop. | Ready for human test, tester handoff, or blocked with required input. |
| Ticket worker | Complete the bound issue. | Ready for testing or blocked with required input. |
| Tester | Prove pass/fail. | Acceptance passed, evidenced failure, or planner decision required. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | <path or URL> | <core context> | Always |
| 2 | <path or URL> | <implementation context> | Worker |
| 3 | <path or URL> | <test context> | Tester |

## Architecture And Context

Summarize the system pieces, constraints, and vocabulary needed to work on this epic.

Keep this section high-signal. Link to GitHub issues, PRs, commits, logs, and deeper notes instead of copying ticket-level detail here.

Pre-authoring discovery: Search the current repository and explicitly named relevant repositories/services, with a default 15-minute search budget. Record scope, queries/paths, findings, elapsed time, and inaccessible or unsearched areas. Expand only for a concrete dependency within authorized scope; record any revised budget. At expiry, choose a justified method with uncertainty recorded, or escalate if the missing evidence blocks safe progress. Never infer absence outside the searched scope.

Search scope: <current repo and named relevant repositories/services>
Search budget: 15 minutes
Search evidence: <queries/paths, findings, elapsed time, unsearched/inaccessible areas>
Method rationale: <source suitability, required adaptations, or bounded BUILD justification>

`PORT from <repo/path>` moves an existing implementation; `DUPLICATE from <working unit>` copies a proven unit; `BUILD (no suitable source found in recorded scope)` records a bounded search outcome. Inspect sources before authoring. Adapt beyond imports/config when requirements require it, recording why and validating the adapted behavior. If reuse is unsuitable, record the reason rather than forcing a transplant or silently rebuilding.

Waves: Wave 1: <A> ∥ <B> (disjoint file surfaces). Wave 2: <C>. Then the epic worker owns the final journey loop. Heartbeat every 30 minutes: `lap/state | blocker | ETA`; two consecutive ETA slips stop the thread and report options.

Proportional ceremony: live customer data requires snapshot + checksum + one restore drill per mechanism per epic; dead/test/reversible assets use snapshot-and-go; docs require none.

## Decisions

Use this as durable anti-repetition memory. Pre-answer likely manager choices with stable IDs and absence rules. For rejected or superseded approaches, state what was tried and keep deep investigation in the linked issue, PR, ADR, or source memory.

| ID | Date | Outcome | Decision / Attempt | Durable Summary | Rule / Absence Rule | Evidence | Revisit When |
|---|---|---|---|---|---|---|---|
| D1 | YYYY-MM-DD | accepted | <choice the sleeping manager may face> | <why this is now the operating choice> | <answer; safe authorized fallback or named gate if required input is absent> | <link> | n/a |
| D2 | YYYY-MM-DD | accepted | Credentials | Reuse the existing authorized credential source when needed. | Read from <authorized location, or n/a>; preserve access gates and do not recreate credentials. | <link> | n/a |
| D3 | YYYY-MM-DD | accepted | Anything unanswered | Preserve bounded autonomy. | Choose a safe reversible option within approved scope and journal uncertainty; required approvals remain gates. | this spine | n/a |
| D4 | YYYY-MM-DD | rejected | <approach tried> | <why it was rejected> | Do not retry unless the revisit condition is met. | <link> | <condition that would justify reconsideration, or never> |

## Issue Ledger

| Issue | Wave | Method | Budget | Role | Owner / Assignment | Title | Status | Depends On | Worktree | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| draft | 1 | PORT from <repo/path> | 90 min | Ticket worker | <task/thread/agent> | <first touchable ticket> | draft | - | `../wt-<ticket>` | `<branch>` | <pinned SHA> | Journey steps 1–2 | - | YYYY-MM-DD HH:MM TZ | <next action> |

## Branch And Integration

- Default integration branch: `main`
- Worker isolation: FIRST ACTION for every worker/tester is `git worktree add ../wt-<ticket> -b <branch> <pinned-base>`. The primary/shared clone stays pinned to the integration branch and is read-only; `git checkout`/`git switch` there is a branch-ransom defect.
- Dispatch record: branch, absolute worktree path, base commit, integration target, owner, and latest verified time.
- Review gate: implementation complete, PR open, and required automated checks passing.
- Testing gate: exact commit available in a named test surface; acceptance validation in progress.
- Done gate: acceptance passed, evidence linked, residual risk recorded, and spine reconciled.
- Integration rule: merge small reviewed work after required checks pass so new agents bootstrap from the freshest validated base.
- If not merged, the issue ledger must show branch/PR, blocker, owner, latest commit, and next action.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| <product, production, destructive, credential, irreversible, or experiential gate> | <name> | <condition> | <decision or approval> | <independent work or none> |

Do not use `human required` as a complete blocker. Name the decision, owner, evidence, and exact input required.

Blocked protocol: report `BLOCKED ON <owner>: <exact required input>` with evidence; stop dependent work and continue only independent authorized work. Use existing user authorization without asking again. Defaults and absence rules apply only to reversible choices inside approved scope; silence never supplies required approval or authorizes scope expansion. Record unresolved required input in Open Questions and Human Gates, and continue only independent authorized work.

## Recovery And Takeover

Stale assignment policy: manager reassigns any ticket silent past its budget.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| <issue> | <identity> | <identity> | <SHA> | <branch/commits or none> | YYYY-MM-DD HH:MM TZ |

## Planner Queue

- <planning item or question>

## Worker Queue

- <implementation item>

## Tester Queue

- <validation item>

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| YYYY-MM-DD | <issue or milestone> | <SHA> | <local, preview, staging, main> | `<command>` | pass/fail | <link or note> |

## Handoff Journal

### YYYY-MM-DD - <role> - <summary>

Context:
Last attempted:
Result:
Next:
Waiting on:
Approved work:
Risks:
Assignment identity:
Branch / latest commit:
Last verified:
Links:

## Open Questions

- <unresolved required input with owner and exact question, or none>. Put routine safe defaults in Decisions; unanswered required approvals remain Human Gates.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| YYYY-MM-DD | <path or URL> | <summary> | <link> | <owner> | proposed |

Use `registration pending` when a new branch spine exists but the parent steward has not yet added its reciprocal Spine Map row. Do not describe that spine as connected until registration is complete.

## Appendix

Inputs from human (each item names a safe authorized fallback or a gate):

| Input | Owner | Needed By | Absence Rule |
|---|---|---|---|
| <input or none> | <human> | <phase> | <safe authorized fallback, or stop dependent work at named gate> |

### Worker Dispatch Prompts

Store complete paste-ready prompts here, versioned with the spine. Begin each with `assets/dispatch-prompt-preamble.md`, bind role/spine/issue/terminal state/Human Gates, state the one-paragraph mission, and end with `Go.`
