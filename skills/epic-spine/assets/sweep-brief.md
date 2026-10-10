# Sweep Brief
Bind with `assets/dispatch-prompt-preamble.md`, then:

```text
Role: worker
Bound repo: <absolute repo path>
ACTIVE worktrees to skip: <absolute paths / branch names>
Task: reclaim disk from finished git worktrees and local branches.
Scope: this repo's worktrees and local branches only; primary checkout is report-only.
```

Classify with plain git, then act only on what is safe:

- **merged + clean** (`git merge-base --is-ancestor <branch> main` exits 0 and `git status --porcelain` is empty in the worktree) → `git worktree remove <path>`, `git branch -d <branch>`.
- **dirty, unmerged, or ACTIVE** → keep; report the reason. Never delete or force.
- Remote branch: delete only if merged and its name starts with `wt/`; report all others.
- Orphan directory (not in `git worktree list` and `git -C <dir> rev-parse --git-common-dir` equals this repo's common dir): report path and size; delete only if empty.
- Primary checkout: report only.

Finish with `git worktree prune` and `git fetch --prune`. Measure `du -sk` of this repo's worktrees (from `git worktree list`, primary excluded) before and after. Never rewrite history, force-push, use `git branch -D`, or touch `main`.

Output:

- `Last sweep: YYYY-MM-DD, N worktrees + M branches removed, X MB reclaimed`
- Kept / needs-user-decision list, one line each with the reason.
