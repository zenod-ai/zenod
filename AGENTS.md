# Zenod agent entrypoint

## Start here

For every repository-level task, read `docs/EPIC-0-FOUNDATION-SPINE.md` first. Its **Current State** and child-spine map are authoritative for project direction, the active delivery surface, human gates, and the next action.

The active delivery surface as of 2026-08-16 is `docs/EPIC-ZENOD-ALPHA-LAUNCH.md`. Read that child spine before selecting, planning, dispatching, or executing Zenod alpha work.

Do not infer priority from the repository-wide GitHub issue list. It contains historical, superseded, blocked, and test-only records. Only issues linked from the active child spine's **Issue Ledger** are selectable for that epic.

## Command contract

- **“Continue”**: bind as the Epic 0 worker and active child-spine delivery manager. Read the root spine, then the active child spine; reconcile its linked GitHub issues/PRs and current `main`; execute the child's single **Next action**; remain the sole spine steward; loop until ready for human test or blocked on a named gate.
- **“Work on ZAL-N” / “work on issue #N”**: first verify the issue is linked and dispatchable in the active child spine. Bind one ticket worker to that issue with its recorded branch, fresh base commit, required reads, acceptance, human gates, and handoff. Use a separate worktree for concurrent work. The delivery manager remains in the parent task and reconciles the worker's GitHub handoff.
- **“What are we working on?”**: report the active child spine's Current State, ready/active issues, owners, blockers, human gates, and one recommended next action. Do not summarize from chat memory alone.

## Write and authority rules

- Read broadly; write narrowly. The active delivery manager/steward writes the bound spine. Ticket workers and testers write detailed work and structured handoffs to their bound GitHub issue unless a narrow spine section is explicitly delegated.
- The spine owns intent, scope, acceptance, dependencies, decisions, and rollup state. GitHub issues own ticket detail. Code/PRs own implementation truth. Named validation evidence owns pass/fail claims.
- One ticket worker = one issue = one dedicated branch. Concurrent workers use separate worktrees. Record base/latest commit, integration target, evidence, blocker, and next action.
- Never treat merged code as deployed proof. Record the exact deployed SHA and named environment before claiming behavior is live.
- Production deployment, credentials, real-card billing, opening public signup, destructive actions, and external posting require the exact human gate recorded in the active spine.

## Current ready batch

- [ZAL-1 #1058](https://github.com/zenod-ai/zenod/issues/1058): alpha-launch truth/readiness audit.
- [ZAL-2 #1059](https://github.com/zenod-ai/zenod/issues/1059): reproduce and repair the incorrect recent-conversation recap.

These two issues may run in parallel only after the control-plane spine commit is available as their common base. Later ZAL issues remain dependency- or approval-gated in `docs/EPIC-ZENOD-ALPHA-LAUNCH.md`.
