# Zenod agent entrypoint

## Start here

For every repository-level task, read `docs/EPIC-0-FOUNDATION-SPINE.md` first. Its **Current State** and child-spine map are authoritative for project direction, the active delivery surface, human gates, and the next action.

The active delivery surface as of 2026-08-27 is `docs/EPIC-P-PHYLAX-SPRINT.md`. It owns the frozen integrated-independent Zenod/PM/Phylax architecture and final-push issue board. Read it before selecting, planning, dispatching, or executing this delivery push. `docs/EPIC-ZENOD-ALPHA-LAUNCH.md` remains read-only historical launch evidence unless the active spine explicitly routes a gate back to it.

Do not infer priority from the repository-wide GitHub issue list. It contains historical, superseded, blocked, and test-only records. Only issues linked from the active child spine's **Issue Ledger** are selectable for that epic.

## Production deployment boundary

Jordi explicitly set this boundary on 2026-09-07: this repository deploys **live Zenod production images**, plus the default **Phylax/WhatsApp companion when appropriate**, and nothing else. A push, merge, documentation change or release here must not automatically deploy Epaminon, Outbound, Callisthenes, x-mcp or other independent agents/services. Keep their legacy automatic triggers disabled; do not re-enable them as part of a Zenod release. Deploy the Phylax companion only when the change actually requires it.

Independent agents should move to their own repositories and deployment lifecycles as separate, incremental follow-up work. Their continued presence in this source tree does not grant deployment authority. The durable procedure, exact live state and reversible trigger receipts are in `docs/EPIC-ZENOD-DEPLOYMENTS-UPGRADES.md`. Preserve running services and data during any later extraction.

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

- [ZPF-1 #1103](https://github.com/zenod-ai/zenod/issues/1103): freeze working journeys and architecture invariants.
- [ZPF-2 #1104](https://github.com/zenod-ai/zenod/issues/1104): create the independent Phylax artifact and isolated instance modes.
- [ZPF-3 #1105](https://github.com/zenod-ai/zenod/issues/1105): make tenant auth, credentials and sessions deployment-stable.
- [ZPF-4 #1106](https://github.com/zenod-ai/zenod/issues/1106): implement the issuer-neutral Phylax allowance/usage ledger when a worker slot opens.

The first three may run in parallel only after the control-plane spine commit is available as their common base. All later work is dependency-gated by `docs/EPIC-P-PHYLAX-SPRINT.md`; do not select from the global issue list.
