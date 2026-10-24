# Git Doctrine

Read this before creating a worktree, committing, integrating, or rolling back. It is the standing authority for how EpicSpine keeps a repository clean: one integration line, `main`, and no work that just accumulates.

Stay in `main`. One integration line — `main` — is where every accepted change lands and is tested. The primary checkout always sits on a clean `main` and is never used to edit code or documents; `git checkout`/`git switch` there is a branch-ransom defect. Every other line of work is a short-lived worktree branch that the delivery manager merges to `main`, verifies in `main`, and then deletes. Because `main` is always the tested line, rollback is `git revert`, not archaeology.

## Additive Work Goes Straight To Main

Everything lives in `main`; a worktree is for work that touches something substantial. Purely additive, no-risk work (new docs, research, shortlists, new files; no edit to existing code or config) is committed and pushed to `main` directly, no worktree, no branch. Anything that edits existing code or config uses a worktree (below).

## Worker Flow

- For work that edits existing code or config, start from a clean `main` and create one local worktree: `git worktree add ../wt-<task> -b wt/<task> main`. No remote branch while it is in flight; one not integrated by task end is pushed (`git push -u origin wt/<task>`) and reported, never left local-only.
- Do all edits, commits, and checks only in the worktree. Never edit the primary checkout.
- Commit with conventional, scoped messages; keep each commit coherent.
- Hand off the branch name, commit SHAs, and verification evidence. Do not push, open a PR, or merge unless the manager or user says so; the manager pushes a branch that is not integrated by task end.
- Keep the branch short-lived: merge to `main` as soon as each step passes its checks (ff or `--no-ff`, never squash; the history must travel), then remove the branch and worktree.
- No branch outlives its task. At task end the work is in `main`; if it cannot be merged it is pushed and reported with a one-line reason. Follow-up work after a merge goes on a NEW branch, never more commits onto a merged one.
- Mark a finished branch with the commit trailer `Ready: yes` on its tip. Nothing without it is ever merged automatically.

## Manager Integration Flow

The manager has standing authority to merge verified work to the declared integration branch. Integrate one worker at a time, in finish order.

1. Verify in the worker's worktree: re-read the diff and run the repository's checks there.
2. If `main` moved, `git rebase main` in the worktree and re-verify.
3. In the primary checkout on clean `main`, `git merge --ff-only wt/<task>` (or `--no-ff` when `main` moved; never squash).
4. Refresh generated artefacts (for example manifests) in a follow-up commit when the repository requires it.
5. Push `main` to origin (fast-forward only, never forced; under `pr-approval` open the PR instead). Do this right after the merge, not at session end: the other machine sees the work only once it is pushed.
6. Test in `main`: run the full checks or CI against the merged result.
7. Remove the worktree and delete the local branch.
8. Record the step (spine Current State and Issue Ledger), commit that update on `main` and push it the same way.

The Stop hook (`scripts/stop_push.py`) pushes committed `main` work at the end of every turn as a safety net: only when the tracked tree is clean, `main` is ahead and not behind, and never under `pr-approval`. It never commits; commits are the agent's job. A repo opts out with `EpicSpine: off` in AGENTS.md or a `.epicspine-off` file.

## Rollback

If `main` goes red, `git revert` the offending commit(s) immediately. Never rewrite pushed history and never force-push `main`. Then re-dispatch a fix. A red `main` is the manager's top priority; everything else waits.

## Parallelism

- Dispatch in waves with disjoint file surfaces; sequence tasks that may touch the same files.
- Integration is always serial, even when workers ran in parallel. One merge to `main` at a time.

## Soft Return To Main

Never force a merge on a branch that is not ready. The background job (`scripts/auto_return.py`, `Integration policy: main-direct` only; off with `EPICSPINE_AUTOMERGE=off` or `Auto-merge: off`) merges a `Ready: yes` branch itself only when its diff purely adds files and touches no `Deploy gate:` path/glob (a gate value that is not only paths/globs, or an `Integration policy:` text mentioning a PR or CI, blocks the whole repo: when in doubt, no merge), it merges cleanly, it has no open PR (needs `gh`), it is >= 2 h old and its worktree is clean with nothing running in it: `--no-ff`, push ff-only, then branch and worktree removed. Branches already in `main` are deleted (origin only `wt/*`). Everything else is reported: nothing for 3 days; an attention line from 3 days; at 14 days **park** it: push and verify an annotated tag `archive/<name>`, then delete the branch (local and origin) and its worktree; never asked or reminded again (drop = the same, by intent). Anything archived first is cleaned up without asking; never delete without the tag unless the branch is an ancestor of `main`. A branch whose tip is under an `archive/*` tag is never reported.

## Pull Requests

Pull requests are optional, not default. On GitHub repos set `delete branch on merge` and allow `merge commit` / `rebase`, not squash (a squash drops the branch's history and makes it look unmerged). Open one only when the user asks for review, the repository declares `Integration policy: pr-approval`, the change touches a declared `Deploy gate:`, or CI-gating on a branch is genuinely needed. Even then the manager merges it when checks pass and the user has not reserved the decision.

## Clean Repo Contract

After every integration with no work in flight, the repository is in this end-state:

- exactly one branch: `main`;
- exactly one worktree: the primary checkout;
- `git status` clean;
- `main` equal to `origin/main` (nothing committed and unpushed);
- no stray remote branches.

The manager audits this at the end of each task and fixes drift before declaring done.

## Authority And Override

This doctrine is the standing grant for the manager to merge verified work to `main`.

- A repository declares `Integration policy: main-direct` (default for new setups) or `Integration policy: pr-approval` in its root spine or `AGENTS.md`, and, if it deploys, `Deployed from: <branch/host/path>` so agents can tell what is live before cleaning. Under `pr-approval` the manager opens a PR and waits for the user. `main-direct` is the default for every repo; the only exception is a push to main that forces a complex production deployment (e.g. zenod: push-to-main rolls production), declared as `Deploy gate: <paths/workflows/branches>` next to `Deployed from:`: PR/CI applies to those alone, never the whole repo when the deploy can be gated narrowly; docs-only, additive and research changes that do not trigger the deploy stay main-direct.
- A per-task user instruction overrides both.
- Never merge work that failed its checks. Never merge into a branch other than the declared integration branch.

## Destructive-Action Guard

Never delete a branch or worktree whose commits are not reachable from `main` unless the user says so. Discarding unmerged work requires explicit approval.
