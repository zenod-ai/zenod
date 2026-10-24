#!/usr/bin/env python3
"""Return finished work to main, softly (called per repo by local_mess.guard): never force, never lose history.

1. Auto-merge, only in repos declaring ``Integration policy: main-direct`` and not opted out (``EPICSPINE_AUTOMERGE=off`` or
   ``Auto-merge: off`` in AGENTS.md): a local or origin branch is merged when ALL hold: its tip commit carries the trailer
   ``Ready: yes``; its diff against the merge-base only ADDS files (no M/D/R/T; none under ``.github/`` or named ``.git*``) and
   touches no ``Deploy gate:`` entry; the repo's gate value is only paths/globs and its Integration policy text mentions no PR
   or CI (else the whole repo is blocked, see ``deploy_gate.py``); ``git merge-tree --write-tree origin/<integration> <tip>``
   is clean; ``gh pr list --head <branch> --state open`` runs and is empty; the tip is >= 2 h old; its worktree, if any, is clean
   with no process inside. Then: ``--no-ff`` merge in a temporary detached worktree, ``git push`` ff-only (rejected: stop and
   report), then the worktree, local and origin branch are removed (<= 3 merges per run).
2. Already in main: a branch merged into ``origin/<integration>`` with no worktree is deleted locally; on origin only when named
   ``wt/*`` (others: one "merged - safe to delete" line). A branch whose tip IS the integration tip is kept (may be brand new).
3. Everything else is report only: Ready but blocked (with the reason); unmerged and idle >= 3 d, one line; >= 14 d, one line
   telling the agent to park it, no question (archive tag, then delete); refs under an ``archive/*`` tag are never reported. Skipped for ``pr-approval`` repos.
Fetches with ``--prune`` first (no network: nothing happens). Returns ``{"auto": [...], "mess": [...], "gone": [paths]}``.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import deploy_gate
import repo_sync
from session_sync import Clock, git, out

READY_AFTER, MAX_MERGES, PR_SECONDS, IDLE, ASK, SHOWN = 2 * 3600, 3, 10.0, 3 * 86400, 14 * 86400, 3
PARK = "park it now, no question (push and verify tag archive/<name>, delete the branch and worktree; references/hygiene.md)"
DENY = re.compile(r"^\.github/|(^|/)\.git[a-z]*$")
FORMAT = "%(refname)|%(objectname)|%(committerdate:unix)|%(trailers:key=Ready,valueonly,separator=%x2C)"


def cwds() -> list[str]:
    """Working directories of every process (Linux ``/proc``; else ``lsof -d cwd``); best effort, [] on failure."""
    proc, found = Path("/proc"), []
    if (proc / "self").exists():
        for entry in proc.iterdir():
            if entry.name.isdigit():
                try:
                    found.append(os.readlink(entry / "cwd"))
                except OSError:
                    continue
        return found
    try:
        text = subprocess.run(["lsof", "-a", "-d", "cwd", "-Fn"], capture_output=True, text=True, timeout=8).stdout
    except (subprocess.TimeoutExpired, OSError):
        return []
    return [ln[1:] for ln in text.splitlines() if ln.startswith("n")]


def listing(top: Path, clock: Clock, base: str, integration: str) -> dict[str, dict]:
    """name -> {local, remote, ts, ready, merged} for every branch but the integration one and refs under an ``archive/*`` tag (merged: every ref is in ``base``)."""
    def rows(*extra: str) -> list[list[str]]:
        text = out(git(["for-each-ref", *extra, f"--format={FORMAT}", "refs/heads", "refs/remotes/origin"], top, clock, 5)) or ""
        return [ln.split("|") for ln in text.splitlines() if ln.count("|") == 3]

    def split(ref: str) -> tuple[str, bool]:
        return (ref.removeprefix("refs/heads/"), True) if ref.startswith("refs/heads/") else (ref.removeprefix("refs/remotes/origin/"), False)

    in_base = {r[0] for r in rows("--merged", base)}
    tags = (out(git(["for-each-ref", "--format=--merged=%(refname)", "refs/tags/archive"], top, clock, 4)) or "").split()
    archived = {r[0] for r in rows(*tags)} if tags else set()
    found: dict[str, dict] = {}
    for ref, sha, ts, trailer in rows():
        name, local = split(ref)
        if name in (integration, "HEAD") or not ts.isdigit() or (ref in archived and ref not in in_base):
            continue
        entry = found.setdefault(name, {"ts": 0, "ready": False, "merged": True})
        entry["local" if local else "remote"] = sha
        entry["ready"] = entry["ready"] or "yes" in trailer.lower().split(",")
        entry["ts"], entry["merged"] = max(entry["ts"], int(ts)), entry["merged"] and ref in in_base
    return found


def why_not(top: Path, clock: Clock, base: str, name: str, info: dict, now: float, wt: Path | None, gate: list[str]) -> str | None:
    """None when ``name`` may be merged automatically, else the reason it may not."""
    tip = info.get("local") or info.get("remote")
    if info.get("local") and info.get("remote") and info["local"] != info["remote"]:
        return "local and origin tips differ"
    if now - info["ts"] < READY_AFTER:
        return "last commit under 2 h old"
    mb = out(git(["merge-base", base, tip], top, clock, 4))
    diff = git(["diff", "--name-status", "-M", mb or base, tip], top, clock, 5)
    lines = diff.stdout.splitlines() if diff is not None and diff.returncode == 0 and mb else []
    if hit := deploy_gate.touched(gate, [p for ln in lines for p in ln.split("\t")[1:]]):
        return f"touches Deploy gate {hit}"
    if not lines or any(not ln.startswith("A\t") or DENY.search(ln[2:]) for ln in lines):
        return "it changes or deletes existing files (not purely additive)"
    tree = git(["merge-tree", "--write-tree", base, tip], top, clock, 8)
    if tree is None or tree.returncode != 0:
        return "it does not merge cleanly"
    if wt is not None:
        dirty = git(["status", "--porcelain"], wt, clock, 4)
        if dirty is None or dirty.returncode or dirty.stdout.strip():
            return "its worktree has uncommitted changes"
        if any(c == str(wt.resolve()) or c.startswith(str(wt.resolve()) + os.sep) for c in cwds()):
            return "a process is running inside its worktree"
    try:
        pr = subprocess.run(["gh", "pr", "list", "--head", name, "--state", "open", "--json", "number"], cwd=str(top),
                            capture_output=True, text=True, timeout=min(PR_SECONDS, max(1.0, clock.cap(PR_SECONDS))))
        open_prs = json.loads(pr.stdout) if pr.returncode == 0 else None
    except (OSError, ValueError, subprocess.TimeoutExpired):
        open_prs = None
    if open_prs is None:
        return "gh could not check for an open PR, so it is not merged"
    if open_prs:
        return "it has an open PR"
    return None


def merge_one(top: Path, clock: Clock, base: str, integration: str, name: str, tip: str) -> str | None:
    """``--no-ff`` merge in a temporary worktree and a fast-forward push; an error text, or None when pushed."""
    tmp = Path(tempfile.mkdtemp(prefix="epicspine-merge-"))
    ident = [] if out(git(["config", "user.email"], top, clock, 3)) else ["-c", "user.name=EpicSpine", "-c", "user.email=epicspine@localhost"]
    try:
        if git(["worktree", "add", "--detach", "-q", str(tmp), base], top, clock, 8) is None:
            return "could not create the temporary worktree"
        msg = f"Merge branch '{name}' (EpicSpine: Ready: yes, additive only)"
        done = git([*ident, "merge", "--no-ff", "-q", "-m", msg, tip], tmp, clock, 8)
        if done is None or done.returncode:
            return "the merge failed"
        pushed = git(["push", "--quiet", "origin", f"HEAD:refs/heads/{integration}"], tmp, clock, 15)
        return None if pushed is not None and pushed.returncode == 0 else f"origin rejected the push to {integration}"
    finally:
        git(["worktree", "remove", "--force", str(tmp)], top, Clock(5), 5)
        shutil.rmtree(tmp, ignore_errors=True)
        git(["worktree", "prune"], top, Clock(5), 5)


def delete(top: Path, clock: Clock, base: str, name: str, info: dict, wt: Path | None, remote: bool) -> list[str]:
    """Remove a branch known to be merged into ``base``: worktree, local branch, origin branch (each re-verified just before)."""
    def in_base(sha: str) -> bool:
        proc = git(["merge-base", "--is-ancestor", sha, base], top, clock, 3)
        return proc is not None and proc.returncode == 0

    did = []
    if wt is not None:
        git(["worktree", "remove", str(wt)], top, clock, 8)  # never forced: a dirty worktree stays
        if wt.exists():
            return did
        did.append(f"removed worktree {wt}")
    if info.get("local") and in_base(info["local"]) and (done := git(["branch", "-D", name], top, clock, 4)) is not None and done.returncode == 0:
        did.append(f"deleted local branch {name}")
    sha = (out(git(["ls-remote", "origin", f"refs/heads/{name}"], top, clock, 8)) or "").split()
    if remote and info.get("remote") and sha[:1] == [info["remote"]] and in_base(info["remote"]) \
            and (gone := git(["push", "--quiet", "origin", "--delete", name], top, clock, 10)) is not None and gone.returncode == 0:
        did.append(f"deleted origin branch {name}")
    return did


def many(items: list[str]) -> str:
    return ", ".join(items[:SHOWN]) + (f" +{len(items) - SHOWN} more" if len(items) > SHOWN else "")


def run(top: Path, clock: Clock, env: dict, text: str, integration: str, trees: list[tuple[Path, str]], now: float) -> dict:
    result: dict = {"auto": [], "mess": [], "gone": []}
    base, label = f"origin/{integration}", top.name
    if not repo_sync.fetch(top, clock, 15, "--prune")[0] or not out(git(["rev-parse", "--verify", "-q", base], top, clock, 3)):
        return result
    policy = (repo_sync.field(text, "Integration policy") or "").lower()
    gate, bad = deploy_gate.gate(text)
    stop = deploy_gate.policy_problem(text) or bad
    on = policy == "main-direct" and str(env.get("EPICSPINE_AUTOMERGE", "")).strip().lower() != "off" \
        and (repo_sync.field(text, "Auto-merge") or "").lower() != "off"
    head, base_tip = (out(git(args, top, clock, 3)) for args in (["symbolic-ref", "--short", "-q", "HEAD"], ["rev-parse", base]))
    by_branch, found = {b: p for p, b in trees}, listing(top, clock, base, integration)
    safe, blocked, idle, merges = [], [], [], 0
    for name, info in sorted(found.items()):
        if info["merged"]:
            if name in by_branch or name == head or base_tip in (info.get("local"), info.get("remote")):
                continue
            did = delete(top, clock, base, name, info, None, name.startswith("wt/")) if on else []
            result["auto"] += [f"{label}: already in {integration}: {d}" for d in did]
            if (info.get("remote") and not (on and name.startswith("wt/"))) or (info.get("local") and not on):
                safe.append(name)
        elif info["ready"] and policy != "pr-approval":
            reason = "auto-merge is off or the Integration policy is not main-direct" if not on else f"auto-merge is blocked for this repo: {stop}" if stop else "it is checked out" if name == head \
                else "no merge slot left this run" if merges >= MAX_MERGES else why_not(top, clock, base, name, info, now, by_branch.get(name), gate)
            if reason:
                blocked.append(f"{name} ({reason})")
                continue
            failed = merge_one(top, clock, base, integration, name, info.get("local") or info["remote"])
            if failed:
                result["mess"].append(f"{label}: auto-merge of {name} stopped: {failed} — nothing was changed; merge it by hand")
                break
            merges += 1
            repo_sync.fetch(top, clock, 10)
            wt = by_branch.get(name)
            result["auto"] += [f"{label}: merged {name} into {integration} (--no-ff, pushed)"] + [f"{label}: {d}" for d in delete(top, clock, base, name, info, wt, True)]
            if wt is not None and not wt.exists():
                result["gone"].append(wt)
            if head == integration and not out(git(["status", "--porcelain", "--untracked-files=no"], top, clock, 4)):
                git(["merge", "--ff-only", "--quiet", base], top, clock, 8)
        elif policy != "pr-approval" and name not in by_branch:
            idle.append((int((now - info["ts"]) // 86400), name))
    old, mid = [n for d, n in sorted(idle, reverse=True) if d * 86400 >= ASK], [n for d, n in sorted(idle, reverse=True) if IDLE <= d * 86400 < ASK]
    for items, line in ((blocked, "branch(es) marked Ready but not auto-merged: {items} — the manager merges them (ff or --no-ff, never squash)"),
                        (mid, "branch(es) not in {b} idle >= 3d: {items} — finish and mark `Ready: yes`, merge, or remove"),
                        (old, "branch(es) not in {b} idle >= 14d: {items} — " + PARK),
                        (safe, "branch(es) already in {b} — safe to delete: {items}")):
        if items:
            result["mess"].append(f"{label}: {len(items)} " + line.format(b=integration, items=many(items)))
    return result
