# Repo Hygiene And Sweeps

A **sweep** is a cheap standard WORKER task that reclaims disk from finished git worktrees and local branches. It is not a role and not part of integration. The delivery manager owns the schedule and the record; the user only talks to the manager.

Normal-path hygiene is not a sweep: after integrating a worker, the manager stops any server started from its worktree, then removes the worktree and local branch (`git worktree remove`, `git branch -d`, `git worktree prune`). A worker branch not integrated by task end is pushed to origin (`git push -u origin <branch>`) and reported, never left local-only: other machines see only what is pushed. A sweep is the backstop for what slipped through.

The 15-minute background job (`scripts/local_mess.py`, `scripts/auto_return.py`) backs this up. It pushes local-only branches (never forced; `EPICSPINE_PUSH_BRANCHES=off` or `Push branches: off` in AGENTS.md opts out). In `Integration policy: main-direct` repos it merges a branch whose tip carries `Ready: yes` when the diff only adds files, nothing conflicts, no PR is open (needs `gh`), the tip is >= 2 h old and its worktree is clean with no process inside (`--no-ff`, ff-only push, then branch and worktree removed; `EPICSPINE_AUTOMERGE=off` or `Auto-merge: off` opts out); it deletes branches already in `main` that have no worktree (origin only `wt/*`). Everything else is recorded and shown as `EpicSpine attention:` only inside a session in that repo: idle worktrees and branches (3 days: reminder; 14 days: park it, no question: push and verify the tag `archive/<name>`, then delete the branch and worktree; a tip under an `archive/*` tag is never reported), tracked changes uncommitted > 24 h, http servers > 24 h in a worktree, more than 3 open worktrees (finish or merge one first). SessionStart prints `EpicSpine state:`; `scripts/repo_state.py` prints a table of every repo (on request only: no session is told about other repos). Act on the lines: merge or remove, commit or discard, stop the server.

## Cleanup Safety Checklist

Learned in the 2026-10-16 VPS cleanup (`docs/hygiene/2026-10-16-cleanup.md`). Before deleting any branch or worktree:

1. `git fetch --prune` again right before each delete: concurrent workers move `main`.
2. A MERGED PR does not prove the branch is in `main`: compare the PR's `headRefOid` with the branch tip (commits pushed after a squash merge are NOT in `main`) and check the PR base is `main` (a stacked PR merges into another branch).
3. `gh pr list` truncates: ask per branch with `--head <branch>`.
4. Deployed code may run from containers or root-owned checkouts: read the repo's `Deployed from:` line and the running processes before touching anything that might be live.
5. Not an ancestor of `main` and not wanted: push an annotated tag `archive/<name>`, verify it on origin, then delete: this is **park** (drop is the same by intent), done without asking. Never delete without the tag.
6. Files a cron job or timer writes must not stay tracked and dirty in a primary checkout: commit them from the job or gitignore them.
7. Never squash: merge with history (ff or `--no-ff`).

## When To Dispatch A Sweep

The manager checks at bind and at end of each task. Dispatch when any trigger holds:

- `Last sweep` is absent or older than 7 days.
- More than one worktree, or more than one local branch besides `main`.
- This repo's worktrees (paths from `git worktree list`, primary checkout excluded) exceed 500 MB total.
- The user asks.

Never sweep while integrating; pass the sweep the list of ACTIVE worktrees to skip.

```sh
git worktree list
git branch --list
git worktree list --porcelain | sed -n 's/^worktree //p' | tail -n +2 | xargs -I{} du -sk {} 2>/dev/null
```

## Sweep Classification

Classify every worktree and local branch, then act only on what is safe:

| State | Test | Action |
|---|---|---|
| Merged | `git merge-base --is-ancestor <branch> main` exits 0 | eligible to remove |
| Clean | `git status --porcelain` in the worktree is empty | required with merged |
| Dirty, unmerged, or active | either test fails, or the worktree is ACTIVE | keep and report; never delete or force |
| Remote branch | merged and name starts with `wt/` | delete it; report every other remote |
| Orphan directory | not in `git worktree list` **and** `git -C <dir> rev-parse --git-common-dir` equals this repo's `git rev-parse --git-common-dir` | report path and size; delete only if empty |
| Primary checkout | always | report only; never clean |

Only paths from this repo's `git worktree list` are treated as this repo's worktrees; directories belonging to other repos that share the parent folder are never examined, reported, or touched. `git worktree prune` handles registered-but-missing paths.

Remove in this order: `git worktree remove <path>`, then `git branch -d <branch>`, then `git worktree prune` and `git fetch --prune`. Never rewrite history, force-push, use `git branch -D`, or touch `main`.

## Record And Report

Write one line to the root spine: `Last sweep: YYYY-MM-DD, <result in ≤ 10 words>` (absent means never). A sweep returns one summary line (date, N worktrees + M branches removed, MB reclaimed from `du -sk` before/after) plus the kept / needs-decision list with reasons.

Tell the user only when something needs their decision or more than 100 MB was reclaimed; otherwise the record line is enough.

A sweep also stops any local artifact server the manager or a worker started for a finished task (see `references/artifacts.md`).
