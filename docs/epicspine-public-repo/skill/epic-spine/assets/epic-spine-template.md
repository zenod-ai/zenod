# EPIC: <name>

Status: draft
Created: YYYY-MM-DD
Updated: YYYY-MM-DD
Repository: <owner/repo or path>
Primary document: <link or path to this file>
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
| Epic worker | <task/thread/agent> | <epic scope> | Act as delivery lead and spine steward; create/update issues within accepted scope, dispatch ticket workers, reconcile integration state. | Spine ledger, dispatch state, blockers, tested commit/environment, next action. |
| Ticket worker | <task/thread/agent> | <issue URL or ledger row> | Execute assigned issue branch; write issue detail and structured handoff; no spine edits unless narrowly delegated. | PR/branch, latest commit, validation notes, blocker, next action in issue. |
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

## Mission

State the outcome in one paragraph. Write for a capable teammate who has not seen the chat history.

## Definition Of Done

- [ ] <observable final acceptance criterion>
- [ ] <observable final acceptance criterion>
- [ ] <required validation or release criterion>

## Non-Goals

- <explicitly out of scope>

## Current State

Phase: planning | implementation | testing | blocked | complete
Last verified: YYYY-MM-DD HH:MM TZ
Integration target: main
Fresh base commit: <SHA>
Next action: <single next action>
Blockers: <none or list>

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

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| YYYY-MM-DD | <decision> | <why> | <link> |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| draft | Planner | <task/thread/agent> | <ticket title> | draft | - | - | <SHA> | <ticket acceptance> | - | YYYY-MM-DD HH:MM TZ | <next action> |

## Branch And Integration

- Default integration branch: `main`
- Worker isolation: one ticket worker per dedicated branch; concurrent workers use separate worktrees for filesystem isolation.
- Dispatch record: branch, worktree if used, base commit, integration target, owner, and latest verified time.
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

## Recovery And Takeover

Stale assignment policy: <time or project-specific rule>

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
Next:
Risks:
Assignment identity:
Branch / latest commit:
Last verified:
Links:

## Open Questions

- <question> Owner: <owner>. Needed by: <date or phase>.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| YYYY-MM-DD | <path or URL> | <summary> | <link> | <owner> | proposed |

## Appendix

Add lower-priority links, raw notes, or source material that should not interrupt fast bootstrap.
