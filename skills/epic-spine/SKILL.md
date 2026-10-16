---
name: epic-spine
description: EpicSpine / Epic Spine document-centric operating system for AI-assisted software work. Use when asked to epicspine an epic; create, read, orient on, maintain, execute from, or update backlog tickets for a living epic document; dispatch parallel planner/worker/tester agents; map bootstrap context; or track authority, issues, branches, PRs, decisions, acceptance criteria, handoffs, and validation evidence—keeping the epic document authoritative for intent while issues are executable tickets.
---

# EpicSpine

## Overview

A spine is the living document of intent, context, and state for one scoped body of work; a fresh agent binds from it in minutes.
Three surfaces: the **spine** owns intent, scope, acceptance, decisions, and rollup state; **issues/tickets** are the execution board for one concrete step; **code and tests** are the truth of what exists and what passed.
Call the pattern **EpicSpine**; use `epic-spine` for files, labels, branches, and skill references.

## Default Behaviors

These apply to every task unless the user or the root spine overrides.

1. Bind a base role before acting: delivery manager (default for the agent the user talks to) or worker (when dispatched). `references/roles-and-dispatch.md`
2. Detect your write scope and any active Book binding from `AGENTS.md` / the root spine; referenced spines stay read-only. `references/spine-model.md`, `references/book-companion.md`
3. The manager coordinates and never implements: settle open decisions with the user before dispatch (one real fork at a time, with a recommendation), then dispatch workers with the dispatch profile (the root spine's `Dispatch profile:` override, else `~/.agents/epicspine-profile.local.md`, else `~/.agents/epicspine-profile.md` (synced from the skill's `assets/epicspine-profile.md` by the hook); if none exists, ask once, recommend a lower-cost native subagent, and save it with `agents_block.py profile --set` (the local override); the SessionStart hook warns while it is missing), verify output independently on two axes—repo standards and the ticket's spec—and report. `references/roles-and-dispatch.md`
4. Stay in `main`: workers use a local worktree `wt/<task>`; the manager merges verified work itself (ff-only), tests in `main`, `git revert` on red; PRs optional; the user never has to merge. `references/git-doctrine.md`
5. Learnings: read the root `Operating Learnings` **Always** at bind; the first reply states `Learnings in force:` (≤ 5 lines); when the user repeats a correction or states always/never/I prefer, write the learning at once and say `Saved learning L-n: … (say 'undo' to remove)`; never ask first; a reversal also fixes every current repo instruction that says the old thing, in the same commit. `references/learnings.md`
6. Freshness: the SessionStart hook self-syncs the skill, `~/.agents/epicspine-profile.md`, the current repo (ff-pull, push per Integration policy) and a missing AGENTS.md block in every repo (`Root spine: none` without a spine) / `## Operating Learnings` (uncommitted: commit them); a Stop hook pushes committed integration-branch work each turn (agents on other machines see only what is committed and pushed, so commit each passing step at once); a machine-wide background sync (cron on Linux, launchd on macOS, every 15 min, installed by `install-global`) keeps every repo under `~/github` etc. pulled, pushed and gated without anyone opening it, and the hook prints its `attention:` lines for any repo; act on its `EpicSpine sync/setup/attention:` lines. `skill_update.py status` remains for manual checks. `references/skill-update.md`
7. Hygiene: remove a worker's worktree and branch right after integrating; dispatch a sweep when `Last sweep` is absent, over 7 days old, clutter exists, or the user asks. `references/hygiene.md` + `assets/sweep-brief.md`
8. HTML/visual artifacts: serve them from `127.0.0.1` (Tailscale automatically on headless hosts) and report a clickable `http://127.0.0.1:<port>/<file>` URL (verified HTTP 200), never a path or `file://`; a Stop hook enforces it. `references/artifacts.md`
9. Lean: shortest correct output; load only the references a task triggers; delete rather than add.
10. Report state, evidence, and the single next action; ask only when blocked on a human decision.

## Bind Path

Read in this order, then act:

1. `AGENTS.md` — router only; it never holds live project state.
2. Root spine — `Current State` + `Operating Learnings` **Always**.
3. Only the branch spine whose mission contains the task — its `Current State`, Decisions, and Issue Ledger.

Fall back to read-only orientation when the role, spine, or issue is unclear.
Binding fields, one compact line: role | bound spine | bound issue | steward | handoff.

## Load On Demand

| Read when the task involves… | Load |
|---|---|
| Creating a spine | `references/spine-creation.md`, `assets/epic-spine-template.md`, `assets/compact-spine-template.md` |
| Hierarchy, authority, write scope, profiles | `references/spine-model.md` |
| Compact profile, state API, migration | `references/compact-state.md`, `scripts/migrate_spine.py` |
| Rollups and projections | `references/execution-rollups.md`, `scripts/rollup_spine.py` |
| Role binding and dispatch profile | `references/roles-and-dispatch.md` |
| Role protocols, gates, branches, bootstrapping | `references/role-protocols.md`, `references/dispatch-prompts.md` |
| Sprint dialect v2 / SHIP-HARDEN | `references/sprint-dialect-v2.md` |
| Ticket backend and issues | `references/ticket-backends.md`, `assets/github-issue-template.md` |
| Structural validation and diagnostics | `references/structural-validation.md`, `scripts/validate_spine.py`, `scripts/spine_fix.py` |
| Operating learnings | `references/learnings.md` |
| Git, worktrees, integration, rollback | `references/git-doctrine.md` |
| Hygiene and sweeps | `references/hygiene.md`, `assets/sweep-brief.md` |
| Skill freshness and upgrades; session self-sync | `references/skill-update.md`, `references/session-sync.md`, `scripts/skill_update.py`, `scripts/session_sync.py`, `scripts/repo_sync.py`, `scripts/vendored_skill.py`, `scripts/stop_push.py`, `scripts/codex_hooks.py`, `scripts/rehook.py`, `scripts/background_sync.py`, `scripts/sync_schedule.py`, `assets/epicspine-profile.md` |
| A machine dispatcher is configured (`EPICSPINE_DISPATCHER`) | `references/machine-dispatcher.md` |
| Book companion | `references/book-companion.md`, `assets/book-companion-contract.md` |
| Serving HTML/visual artifacts | `references/artifacts.md`, `scripts/artifact_host.py`, `scripts/url_gate.py` |
| A shortlist / selection of candidates is a key deliverable | `references/shortlists.md`, `scripts/build_shortlist.py`, `assets/shortlist.template.html`, `assets/shortlist-sample.json` |
| Repairing a spine or changing the workflow itself | `references/operating-model.md` |
| Any worker dispatch | `assets/dispatch-prompt-preamble.md` |
| Always-on block: repo files, or once per machine (`install-global`: per-harness pointer + session hook) | `assets/agents-block.md`, `assets/global-block.md`, `scripts/agents_block.py`, `scripts/global_install.py`, `scripts/url_gate.py`, `scripts/pre_commit.py` (repo hook, self-installed each session: staged spines/tickets are auto-fixed or must pass `validate_spine.py --trackable`) |

## Machine Dispatcher

Every thread's first turn, greetings included, check the env (`echo "$EPICSPINE_DISPATCHER"`; never assume unset). If set, run it directly: `status` at thread start, bind suffix `· dispatch: <status.name> (<status.available>/<status.capacity> seats)` with the name verbatim, never invented; per worker `pick --task TEXT`, `delegate_task` with its `providerInstanceId`, then `done <id>` (`--fail --signal TEXT` on failure). `id: null` = queue and retry. Command fails or prints garbage: say so, use a native subagent. Repo `Dispatch profile: local-only` opts out. Contract: `references/machine-dispatcher.md`.

## Spine Document Minimums

A spine declares a stable Spine ID, Repository, Primary document, Integration branch and (once connected) Spine Type, Root spine, and Parent spine; it contains Mission, Non-Goals, Current State, Definition Of Done, Issue Ledger, Decisions, and Operating Learnings when it owns rules.
Dashboards read only DoD checkboxes, `Status:`/`Waiting on:` and the Issue Ledger's Issue/Title/Owner/Status (`references/spine-model.md`).
`Current State` carries: Owner, Status, Last attempted, Result, Evidence, Waiting on, Approved work, Next action, Source revision, Verified at.
Validate with `scripts/validate_spine.py --strict <spine.md>`; add `--graph` across the affected local spine family. Criteria are `- [ ] <ID> ...` lines (`references/spine-model.md`); `--fix` repairs the format.
