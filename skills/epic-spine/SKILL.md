---
name: epic-spine
description: EpicSpine / Epic Spine document-centric operating system for AI-assisted software work. Use when asked to epicspine an epic; create, read, orient on, maintain, execute from, or update backlog tickets for a living epic document; dispatch parallel planner/worker/tester agents; map bootstrap context; or track authority, issues, branches, PRs, decisions, acceptance criteria, handoffs, and validation evidence—keeping the epic document authoritative for intent while issues are executable tickets.
---

# EpicSpine

## Overview

A spine is a snapshot of intent, facts and learnings, plus behaviours for maintenance and for dispatching workers; a cold agent binds from it in minutes. Read its first page, "What Every Epic Says", first: `references/spine-model.md`.
Three surfaces: the **spine** owns intent, scope, acceptance, decisions, and rollup state; **issues/tickets** are the execution board for one concrete step; **code and tests** are the truth of what exists and what passed. Call the pattern **EpicSpine**; use `epic-spine` for files, labels, branches, and skill references.

## Default Behaviors

These apply to every task unless the user or the root spine overrides.

1. Bind a base role before acting: delivery manager (default for the agent the user talks to) or worker (when dispatched). `references/roles-and-dispatch.md`
2. Detect your write scope and any active Book binding from `AGENTS.md` / the root spine; referenced spines stay read-only. `references/spine-model.md`, `references/book-companion.md`
3. The manager coordinates and never implements (workers do, in a worktree only for non-additive work): settle open decisions with the user before dispatch (one real fork at a time, with a recommendation), then dispatch workers with the dispatch profile (the root spine's `Dispatch profile:` override, else `~/.agents/epicspine-profile.local.md`, else `~/.agents/epicspine-profile.md` (synced from the skill's `assets/epicspine-profile.md` by the hook); if none exists, ask once, recommend a lower-cost native subagent, and save it with `agents_block.py profile --set` (the local override); the SessionStart hook warns while it is missing), verify output independently on two axes—repo standards and the ticket's spec—and report. `references/roles-and-dispatch.md`
4. Stay in `main`: purely additive, no-risk work (new docs/research/files) commits and pushes straight to `main`; work editing existing code/config uses a worktree `wt/<task>`, merged to `main` as soon as each step passes (ff-only or `--no-ff`, never squash), the manager tests in `main`, `git revert` on red; PRs optional, only for a repo's `Deploy gate:` (the narrow paths/workflows/branches whose push to main rolls a complex production deployment; everything else stays main-direct); the user never has to merge; no branch outlives its task. `references/git-doctrine.md`
5. Learnings: read the root `Operating Learnings` **Always** at bind, plus the bound epic's and every `Parent spine:` ancestor's (all in force); the first reply states `Learnings in force:` (≤ 5 lines), then, if the brief names `Bound epic:`, four lines from it (Goal, Done means open, Next action, where context lives) before acting; when the user repeats a correction or states always/never/I prefer, write the learning at once and say `Saved learning L-n: … (say 'undo' to remove)`; never ask first; a reversal also fixes every current repo instruction that says the old thing, in the same commit. `references/learnings.md`
6. Freshness: the SessionStart hook self-syncs the skill, `~/.agents/epicspine-profile.md`, the current repo (ff-pull, push per Integration policy) and a missing AGENTS.md block in every repo (`Root spine: none` without a spine) / `## Operating Learnings` (uncommitted: commit them); a Stop hook pushes committed integration-branch work each turn (agents on other machines see only what is committed and pushed, so commit each passing step at once); a machine-wide background sync (cron on Linux, launchd on macOS, every 15 min, installed by `install-global`) keeps every repo under `~/github` etc. pulled, pushed and gated without anyone opening it, and the hook prints only this repo's `attention:` lines (never other repos': `scripts/repo_state.py` shows them on request); act on its `EpicSpine sync/setup/attention:` lines. `skill_update.py status` remains for manual checks. `references/skill-update.md`
7. Hygiene: right after integrating, stop any server started from the worker's worktree and remove its worktree and branch; a worker branch not integrated by task end is pushed to origin and reported with a one-line reason, never left local-only; mark finished branches `Ready: yes` (the background job auto-merges additive ones in `main-direct` repos, deletes merged ones, backup-pushes local-only branches and reports idle worktrees/branches, old uncommitted changes, stale servers; > 3 open worktrees: finish one first); before deleting anything follow the cleanup checklist; dispatch a sweep when `Last sweep` is absent, over 7 days old, clutter exists, or the user asks. `references/hygiene.md` + `assets/sweep-brief.md`
8. HTML/visual artifacts: serve them from `127.0.0.1` (Tailscale automatically on headless hosts) and report a clickable `http://127.0.0.1:<port>/<file>` URL (verified HTTP 200), never a path or `file://`; a Stop hook enforces it. `references/artifacts.md`
9. Lean: shortest correct output; load only the references a task triggers; delete rather than add; push facts and detail out of the epic to linked pages (context at the level of the epic, depth by link).
10. Only the user stamps an epic `draft` to `ready` (no agent self-readies; new epics scaffold `draft`). A wake works only runnable epics (`run_state` ready or running from the epic's Status; a spine with children steers and starts no child's rows: `references/spine-model.md` Running). Keep the bound epic tidy and fully informed after each step (state, steps, evidence); record a major finding where it changes the picture, up to the parent if it changes the parent's goal, state or plan; report state, evidence, and the single next action; ask only when blocked on a human action; an action inside an active `## Standing approvals` grant is not an ask (cite `under <code>` in Decisions); finish the job: never end a turn offering follow-ups, do now what moves the goal toward green, closes a known defect or completes the work just done, and drop an unrequested nice-to-have in one line. On every wake and session end rewrite `## Waiting on` as the smallest set of human asks (merge, order by critical path, ≤3, ≤5 min each, self-contained in human format (context, impact, risk, concrete `recommend:`, why this human), close what no longer blocks, never ask for a future gate); Current State's `Waiting on:` lists the codes, and an answer citing a code applies to that ask (`references/spine-model.md`).

## Bind Path

Read in this order, then act:

1. `AGENTS.md` — router only; it never holds live project state.
2. Root spine — `Current State` + `Operating Learnings` **Always**.
3. Only the branch spine whose mission contains the task — its `Current State`, Decisions, and Issue Ledger.

Run `python3 <skill dir>/scripts/spines.py --bind <epic>` for steps 2-3's Current State and Operating Learnings (the epic's and every `Parent spine:` ancestor's, up to the root; default root); never Read whole spine files.

Fall back to read-only orientation when the role, spine, or issue is unclear. Binding fields, one compact line: role | bound spine | bound issue | steward | handoff.

## Load On Demand

| Read when the task involves… | Load |
|---|---|
| Creating a spine, any plan/proposal/epic/goal doc, or listing the repo's goals | `references/spine-creation.md`, `scripts/spine_new.py`, `scripts/spines.py`, `scripts/bind.py`, `scripts/doctrine.py`, `scripts/epic_log.py`, `scripts/ask_refs.py`, `scripts/grants.py`, `assets/epic-spine-template.md`, `assets/compact-spine-template.md` |
| What every epic says, hierarchy, authority, write scope, profiles | `references/spine-model.md` |
| Persona tasks: assignees, queues, hand-offs, signed commits, asks as tasks (trial) | `references/persona-tasks.md` |
| Compact profile, state API, migration, rollups, projections | `references/compact-state.md`, `scripts/migrate_spine.py`, `references/execution-rollups.md`, `scripts/rollup_spine.py` |
| Role binding, dispatch profile, role protocols, gates, bootstrapping | `references/roles-and-dispatch.md`, `references/role-protocols.md`, `references/dispatch-prompts.md` |
| Sprint dialect v2 / SHIP-HARDEN | `references/sprint-dialect-v2.md` |
| Ticket backend and issues | `references/ticket-backends.md`, `assets/github-issue-template.md` |
| Structural validation and diagnostics | `references/structural-validation.md`, `scripts/validate_spine.py`, `scripts/spine_fix.py`, `scripts/status_true.py`, `scripts/run_state.py` |
| Cleaning a stale epic tree: closed epics with open rows, non-standard Status words, stale/undecided epics | `references/tree-cleanse.md`, `scripts/tree_audit.py`, `scripts/close_rows.py` |
| Personas, `## Team` tables, ledger assignees | `references/personas.md`, `scripts/personas.py` |
| Standing spines: ongoing work with targets and a scoreboard, never closed | `references/standing-spines.md`, `scripts/standing.py` |
| Operating learnings | `references/learnings.md` |
| Git, worktrees, integration, rollback; hygiene and sweeps | `references/git-doctrine.md`, `references/hygiene.md`, `assets/sweep-brief.md` |
| Skill freshness and upgrades; session self-sync | `references/skill-update.md`, `references/session-sync.md`, `scripts/skill_update.py`, `scripts/session_sync.py`, `scripts/repo_sync.py`, `scripts/fetch_guard.py`, `scripts/vendored_skill.py`, `scripts/stop_push.py`, `scripts/codex_hooks.py`, `scripts/rehook.py`, `scripts/background_sync.py`, `scripts/local_mess.py`, `scripts/local_servers.py`, `scripts/auto_return.py`, `scripts/deploy_gate.py`, `scripts/repo_state.py`, `scripts/sync_schedule.py`, `assets/epicspine-profile.md` |
| A machine dispatcher is configured (`EPICSPINE_DISPATCHER`) | `references/machine-dispatcher.md` |
| Book companion | `references/book-companion.md`, `assets/book-companion-contract.md` |
| Serving HTML/visual artifacts | `references/artifacts.md`, `scripts/artifact_host.py`, `scripts/url_gate.py` |
| A shortlist / selection of candidates is a key deliverable | `references/shortlists.md`, `scripts/build_shortlist.py`, `assets/shortlist.template.html`, `assets/shortlist-sample.json` |
| Repairing a spine or changing the workflow itself | `references/operating-model.md` |
| Any worker dispatch | `assets/dispatch-prompt-preamble.md` |
| Always-on block: repo files, or once per machine (`install-global`: per-harness pointer + session hook) | `assets/agents-block.md`, `assets/global-block.md`, `scripts/agents_block.py`, `scripts/global_install.py`, `scripts/install_guard.py`, `scripts/url_gate.py`, `scripts/pre_commit.py` (repo hook, self-installed each session: staged spines/tickets are auto-fixed or must pass `validate_spine.py --trackable`; a goal doc must also sit in the epic log) |

## Machine Dispatcher

Every thread's first turn, greetings included, check the env (`echo "$EPICSPINE_DISPATCHER"`; never assume unset). If set, run it directly: `status` at thread start, bind suffix `· dispatch: <status.name> (<status.available>/<status.capacity> seats)` with the name verbatim, never invented; per worker `pick --task TEXT`, `delegate_task` with its `providerInstanceId`, then `done <id>` (`--fail --signal TEXT` on failure). `id: null` = queue and retry. Command fails or prints garbage: say so, use a native subagent. Repo `Dispatch profile: local-only` opts out. Contract: `references/machine-dispatcher.md`.

## Epic Log

A repo has one **epic log**: a tree of goals hung from the root spine (the trunk, which states the purpose). Spines are nested markdowns: progress within a goal is written in that goal's spine. A new measurable objective worked over iterative pushes (a sprint or plan, each push unblocking the next) gets a new leaf markdown linked from its parent; a small one-push item stays a `- [ ] <ID> text` DoD line in its parent. This is judgment, not a hard rule. Every goal is named `EPIC-<n>: <short name>`, states its goal in one line and lists measurable success criteria; without a code it cannot be discussed. The child's `Parent spine:` header decides its place; the parent's Spine Map must agree (checked, not trusted); parent state rolls up from children. A goal closes only after its `## Outcome` is written (verdict, one sentence, evidence per Done means).
Create every goal file (plan, proposal, epic, `E<n>-*`) with `scripts/spine_new.py`, from its first commit, never by hand; `scripts/spines.py [--json]` lists the tree, orphans and mismatches; the pre-commit gate blocks a new or already-migrated epic outside the tree, and a new epic missing Goal, Serves, Done means or Status (existing ones only warn). To make an epic compliant: read `missing_sections` from `spines.py --json`, fill each gap from facts already in the repo (ask its owner for any unwritten why, never invent one), slim it to its own level with detail in linked pages, link them, commit. "On latest EpicSpine" means installed **and** docs conform. `references/spine-model.md`

## Spine Document Minimums

Header: stable Spine ID, Repository, Primary document, Integration branch and (once connected) Root spine, Parent spine. Sections per the table in `references/spine-model.md`, plus Operating Learnings when the spine owns rules. `Current State` carries: Owner, Status, Last attempted, Result, Evidence, Waiting on, Approved work, Next action, Source revision, Verified at. Dashboards read only DoD checkboxes, `Status:`/`Waiting on:` and the Issue Ledger's Issue/Title/Owner/Status.
Validate with `scripts/validate_spine.py --strict <spine.md>` (advisory; add `--graph` across the spine family). Criteria are `- [ ] <ID> ...` lines; `--fix` repairs the format.
