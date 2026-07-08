# OPS-RUNNER — git & repo operations (document-driven)

The planner (Epic-Zero) cannot commit/push from its sandbox (stale `.git/index.lock` it can't remove;
`.git` objects it can't unlink). So git & repo ops are their own worker: the **git-runner** runs on
Jordi's machine with real permissions, reads the **▶ NEXT ITERATION** block below, executes it, and
writes a receipt. Same universal order as everyone: *"do the ▶ NEXT ITERATION block, write a
handback, stop."*

## ▶ NEXT ITERATION (git-runner: start here)

**GIT-1 · land the Epic-Zero artifacts + sync to origin.**
1. If `.git/index.lock` exists and no git process is running: `rm -f .git/index.lock`.
2. If the working tree is dirty with planner edits: `git stash`.
3. `git pull origin main` — bring in #643 (Callisthenes fix) + #644 (receipt).
4. `git stash pop` if you stashed; resolve any trivial keep-both conflicts (planner edits are
   append-only / top-block only, worker receipts are bottom-append — they don't overlap).
5. Commit the planner artifacts:
   ```
   git add EPIC-ZERO-OVERVIEW.html \
           docs/EPIC-ZERO-OVERSIGHT.md \
           docs/OPS-RUNNER.md \
           docs/EPIC-2.4-CALLISTHENES-MOVE-0.md \
           docs/EPIC-2.5-ATOMIC-UNITS.md
   git commit -m "docs(epic0): document-driven protocol + git-runner + #645 directive + deck v2"
   ```
6. `git push origin main`.
7. `git worktree prune` — clear the ~20 stale/prunable worktrees.
8. Append a receipt below: the commit SHA, that push succeeded, and the origin HEAD.

_When GIT-1 is done and nothing is queued, this block reads: **⏸ HOLD — nothing queued.**_

## Append zone (git-runner receipts — dated, append-only)

_(none yet)_
