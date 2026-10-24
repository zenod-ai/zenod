# Zenod agent entrypoint

<!-- epicspine:begin repo-1 -->
## EpicSpine — always on, every task, every agent
Root spine: docs/EPIC-0-FOUNDATION-SPINE.md. Read its Current State and Operating Learnings before acting.
Shared EpicSpine rules (bind, dispatch, integrate, links) come from the epic-spine skill's always-on block, injected each session; if it was not, read `assets/global-block.md` in the skill dir (usually `~/.agents/skills/epic-spine`).
Repo values (`Dispatch profile:`, `Integration policy:`, `Skill updates:`) in the root spine or AGENTS.md override skill defaults.
Precedence: user per-task instruction > repo values > skill block.
<!-- epicspine:end -->
Dispatch profile: mechanism: Claude Code `Agent` tool (background), never T3/OpenCode; model: `sonnet` (Sonnet 5.5, same subscription); reasoning: inherited; isolation: worktree-first (`../wt-<task>` on branch `wt/<task>`); parallelism: disjoint waves (root spine D26).
Integration policy: main-direct via self-merged CI-gated PR (`main` requires the `ci` check: push `wt/<task>`, open a PR, merge it yourself when `ci` is green, never bypass with an admin push; remove the worktree and branch; user never merges; production deploy stays a human gate, except the owner-approved push-to-main roll of Zenod production only, root spine D27).
Skill updates: manual (vendored copy; re-sync per `skills/epic-spine.SOURCE`).

## Start here

For every repository-level task, read `docs/EPIC-0-FOUNDATION-SPINE.md` first. Its **Current State** and child-spine map are authoritative for project direction, the open child epics, human gates, and the next action.

Open work is exactly what `python3 <epic-spine skill dir>/scripts/spines.py --repo . --active` lists (as of 2026-10-24: the root, `docs/EPIC-ZENOD-ALPHA-LAUNCH.md` (ZAL, active) and `docs/EPIC-6-HEALTH-DASHBOARD.md` (EPIC-6, ready)); the root goal is a paying user using Zenod over WhatsApp. Closed epics (`Status: done` or superseded, with an `## Outcome`, e.g. EPIC-P, EPIC-2.55, M0-PLAN) and everything under `docs/archive/` are history only, never selectable work.

Do not infer priority from the repository-wide GitHub issue list. It contains historical, superseded, blocked, and test-only records. Only issues linked from the active child spine's **Issue Ledger** are selectable for that epic.

## Production deployment boundary

Jordi explicitly set this boundary on 2026-09-07: this repository deploys **live Zenod production images**, plus the default **Phylax/WhatsApp companion when appropriate**, and nothing else. A push, merge, documentation change or release here must not automatically deploy Epaminon, Outbound, Callisthenes, x-mcp or other independent agents/services. Keep their legacy automatic triggers disabled; do not re-enable them as part of a Zenod release. Deploy the Phylax companion only when the change actually requires it.

Independent agents should move to their own repositories and deployment lifecycles as separate, incremental follow-up work. Their continued presence in this source tree does not grant deployment authority. The durable procedure, exact live state and reversible trigger receipts are in `docs/EPIC-ZENOD-DEPLOYMENTS-UPGRADES.md`. Preserve running services and data during any later extraction.

## Command contract

- **“Continue”**: bind as the Epic 0 worker and active child-spine delivery manager. Read the root spine, then the active child spine; reconcile its linked GitHub issues/PRs and current `main`; dispatch the child's single **Next action** to a worker, verify and integrate it; remain the sole spine steward; loop until ready for human test or blocked on a named gate.
- **“Work on ZAL-N” / “work on issue #N”**: first verify the issue is linked and dispatchable in the active child spine. Dispatch one ticket worker (Sonnet subagent) to that issue with its recorded branch, fresh base commit, required reads, acceptance, human gates, and handoff. Use a separate worktree for concurrent work. The delivery manager remains in the parent task and reconciles the worker's GitHub handoff.
- **“What are we working on?”**: report the active child spine's Current State, ready/active issues, owners, blockers, human gates, and one recommended next action. Do not summarize from chat memory alone.

## Write and authority rules

- Read broadly; write narrowly. The active delivery manager/steward writes the bound spine. Ticket workers and testers write detailed work and structured handoffs to their bound GitHub issue unless a narrow spine section is explicitly delegated.
- The spine owns intent, scope, acceptance, dependencies, decisions, and rollup state. GitHub issues own ticket detail. Code/PRs own implementation truth. Named validation evidence owns pass/fail claims.
- One ticket worker = one issue = one dedicated branch. Concurrent workers use separate worktrees. Record base/latest commit, integration target, evidence, blocker, and next action.
- Never treat merged code as deployed proof. Record the exact deployed SHA and named environment before claiming behavior is live.
- Production deployment, credentials, real-card billing, opening public signup, destructive actions, and external posting require the exact human gate recorded in the active spine.
- Merge is the default for fresh work: finished, CI-green work is merged by the worker that produced it (docs/spine/receipt PRs included); hold only when merging carries real risk of breaking production or hits a human gate; never leave PRs open or branches orphaned. Legacy backlog cleanup is conservative.

## Current ready batch

The ready batch is the **Next action** and Issue Ledger of the open epics listed by `spines.py --active` (see Start here); do not select from the global issue list or from closed epics' boards.

## Secrets: find before you ask
Never ask Jordi for a key we already have. Catalog (names only): https://github.com/AlfaBlok/infra-vps/blob/main/docs/secrets-catalog.md. On VPS1 run `secret find <provider>` (from VPS3: `ssh hetzner_vps_1 secret find <provider>`); reuse a shared key with `secret copy <from-app> <your-app> <NAME> --approved E14-G1`. The Dokploy API key, Cloudflare API token and Hetzner Cloud token are already on VPS1 in `~t3agent/.config/alpha9/` (one-liners in the catalog's "Asked most often" table). Ask Jordi only when `find` is empty, via the T3 `request_secret` card, never chat. Never print a value. On the owner's Mac the Dokploy key is in the Keychain (service `alpha9-dokploy-api-key`): `eval "$(dokploy-env)"`; see "Dokploy credentials — where they live" in `docs/EPIC-ZENOD-DEPLOYMENTS-UPGRADES.md`.
