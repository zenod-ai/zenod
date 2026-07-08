# OPS-RUNNER — git & repo operations (document-driven)

The planner (Epic-Zero) cannot commit/push from its sandbox (stale `.git/index.lock` it can't remove;
`.git` objects it can't unlink). So git & repo ops are their own worker: the **git-runner** runs on
Jordi's machine with real permissions, reads the **▶ NEXT ITERATION** block below, executes it, and
writes a receipt. Same universal order as everyone: *"do the ▶ NEXT ITERATION block, write a
handback, stop."*

## ▶ NEXT ITERATION (git-runner: start here)

**⏸ HOLD — nothing queued.** (GIT-1 landed 2026-07-08 as `201661c`; receipt below.)

## Append zone (git-runner receipts — dated, append-only)

### 2026-07-08 · GIT-1 · artifacts landed + origin synced
- **Lock:** no `.git/index.lock` present — nothing to clear.
- **Sync:** local was 7 behind + diverged. Stashed planner edits (`-u`), rebased local onto
  `origin/main`; the local Z-9 commit `6e967d7` was **skipped as already-applied** (merged upstream
  as #646 / `e3daf6c`), deck-v2 replayed as `ea48495`. `stash pop` → one conflict in
  `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` (worker receipt block vs planner #645 directive) — resolved
  **keep-both** (worker receipts, then `---`, then the #645 ITERATE block); no content lost.
- **Commit:** `201661c` — *docs(epic0): document-driven protocol + git-runner + #645 directive + deck v2*
  (5 files: `EPIC-ZERO-OVERVIEW.html`, `docs/EPIC-ZERO-OVERSIGHT.md`, `docs/OPS-RUNNER.md`,
  `docs/EPIC-2.4-…md`, `docs/EPIC-2.5-…md`).
- **Push:** ✅ `fa66645..201661c  main -> main`. **origin HEAD = `201661c`.** (CI-required bypass noted
  by the remote; push accepted.)
- **Worktree prune:** ran — **no-op, 0 pruned.** The doc's "~20 prunable" is stale: all 23 auxiliary
  worktrees still have **live directories on disk** (several `locked` = active agent sessions), so
  nothing is orphaned for `prune` to reap. Reclaiming them means `git worktree remove <path>` per
  worktree, which deletes real checkouts — **not doing that without an explicit planner/Jordi order.**
  → flagging back to planner: if you want them gone, queue a GIT-2 with the specific paths to remove.
— [git-runner]
