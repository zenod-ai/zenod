# Git Doctrine

Read this before creating a worktree, committing, integrating, or rolling back. It is the standing authority for how EpicSpine keeps a repository clean: one integration line, `main`, and no work that just accumulates.

Stay in `main`. One integration line — `main` — is where every accepted change lands and is tested. The primary checkout always sits on a clean `main` and is never used to edit code or documents; `git checkout`/`git switch` there is a branch-ransom defect. Every other line of work is a short-lived worktree branch that the delivery manager merges to `main`, verifies in `main`, and then deletes. Because `main` is always the tested line, rollback is `git revert`, not archaeology.

## Worker Flow

- Start from a clean `main` and create one local worktree: `git worktree add ../wt-<task> -b wt/<task> main`. No remote branch by default.
- Do all edits, commits, and checks only in the worktree. Never edit the primary checkout.
- Commit with conventional, scoped messages; keep each commit coherent.
- Hand off the branch name, commit SHAs, and verification evidence. Do not push, open a PR, or merge unless the manager or user says so.
- Keep the branch short-lived. It exists only until the manager integrates or discards it.

## Manager Integration Flow

The manager has standing authority to merge verified work to the declared integration branch. Integrate one worker at a time, in finish order.

1. Verify in the worker's worktree: re-read the diff and run the repository's checks there.
2. If `main` moved, `git rebase main` in the worktree and re-verify.
3. In the primary checkout on clean `main`, `git merge --ff-only wt/<task>`.
4. Refresh generated artefacts (for example manifests) in a follow-up commit when the repository requires it.
5. Push `main`.
6. Test in `main`: run the full checks or CI against the merged result.
7. Remove the worktree and delete the local branch.

## Rollback

If `main` goes red, `git revert` the offending commit(s) immediately. Never rewrite pushed history and never force-push `main`. Then re-dispatch a fix. A red `main` is the manager's top priority; everything else waits.

## Parallelism

- Dispatch in waves with disjoint file surfaces; sequence tasks that may touch the same files.
- Integration is always serial, even when workers ran in parallel. One merge to `main` at a time.

## Pull Requests

Pull requests are optional, not default. Open one only when the user asks for review, the repository declares `Integration policy: pr-approval`, or CI-gating on a branch is genuinely needed. Even then the manager merges it when checks pass and the user has not reserved the decision.

## Clean Repo Contract

After every integration with no work in flight, the repository is in this end-state:

- exactly one branch: `main`;
- exactly one worktree: the primary checkout;
- `git status` clean;
- no stray remote branches.

The manager audits this at the end of each task and fixes drift before declaring done.

## Authority And Override

This doctrine is the standing grant for the manager to merge verified work to `main`.

- A repository declares `Integration policy: main-direct` (default) or `Integration policy: pr-approval` in its root spine or `AGENTS.md`. Under `pr-approval` the manager opens a PR and waits for the user.
- A per-task user instruction overrides both.
- Never merge work that failed its checks. Never merge into a branch other than the declared integration branch.

## Destructive-Action Guard

Never delete a branch or worktree whose commits are not reachable from `main` unless the user says so. Discarding unmerged work requires explicit approval.
