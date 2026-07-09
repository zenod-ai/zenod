# <ticket title>

EpicSpine: <link or path>
Role: Epic 0 worker | planner | epic worker | ticket worker | tester
Assignment identity: <stable agent/thread/task/name>
Spine steward: <agent/thread/task/name>
Status: ready
Depends on: <issue links or none>
Bound spine: <same as EpicSpine unless explicitly different>
Dedicated branch: <branch name>
Worktree: <path when concurrent, or n/a>
Base commit: <SHA>
Latest commit: <SHA or same as base>
Integration target: main
Last verified: YYYY-MM-DD HH:MM TZ

## Goal

Describe the ticket outcome in one short paragraph.

Terminal state: review | testing | accepted | blocked with required input | planner decision required

## Context

- Spine section: <heading or anchor>
- Required reads: <links copied from the Bootstrap Map>
- Prior decision: <decision link or none>

Use this issue for detailed ticket work: code paths, blockers, logs, review discussion, and implementation notes. Write back to the EpicSpine only when this work changes durable intent, scope, state, dependency, risk, evidence, or next action.

The ticket worker writes the structured handoff here. The active spine steward reconciles durable state into the spine unless a narrow spine section is explicitly delegated below.

Delegated spine section: <section + authority, or none>

## Acceptance Criteria

- [ ] <observable ticket-level criterion>
- [ ] <observable ticket-level criterion>

## Validation

Required evidence:

- [ ] <test command, review method, screenshot, or deployment check>
- [ ] Exact commit SHA and named environment or test surface recorded

## Human Gates

- Human owner: <name or none>
- Trigger: <condition or none>
- Exact approval / input required: <decision or none>
- Work that may continue independently: <scope or none>

## Handoff Contract

When done, update this issue and notify the spine steward:

- [ ] PR/branch, base and latest commit, evidence, last verified time, and next action
- [ ] Structured handoff answering what changed, why, how to verify, remaining risk, and exact terminal state
- [ ] Validation evidence includes exact commit and environment if testing was performed
- [ ] Proposed Cross-Spine Updates if this work reveals changes needed in read-only spines
- [ ] Merge or PR status against the integration branch
- [ ] Spine steward notified to reconcile Issue Ledger, Handoff Journal, and durable Validation Evidence

## Recovery

- Blocker: <none or precise blocker>
- Exact next action: <one action>
- Takeover notes: <unverified commits, local-only state, credentials, or none>
- Supersedes assignment: <identity or none>

## Notes

<optional constraints, risks, or implementation notes>
