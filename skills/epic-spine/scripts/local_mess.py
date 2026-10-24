#!/usr/bin/env python3
"""Local-mess guard (called per repo by background_sync.py): work that exists on one machine is invisible to the others.

Never forces, commits, touches dirty files or kills processes. Deletes only what is provably in origin/<integration>.
1. Backup push: every local branch except the integration branch with commits on no origin branch is pushed
   (``refs/heads/b:refs/heads/b``, upstream set only when none; <= 10 per run, 10 s each). Diverged from origin or rejected:
   an attention line, never retried with force. Off: ``EPICSPINE_PUSH_BRANCHES=off`` or ``Push branches: off`` in AGENTS.md.
2. Return to main (auto_return.py): merge ``Ready: yes`` additive branches in main-direct repos, delete branches already in
   main, report the rest (Ready but blocked; idle >= 3 d; idle >= 14 d: park it, no question). Off: ``EPICSPINE_AUTOMERGE=off``.
3. Report only (lines for the status file's ``mess``, <= 3 per kind per repo): linked worktrees idle > 3 d and not merged into
   origin/<integration> (>= 14 d: ask the user once); merged + clean ones idle > 1 d (safe to remove); tracked changes in the
   main checkout for > 24 h (oldest changed-file mtime or first seen dirty by an earlier run); http servers running > 24 h from
   inside a linked worktree (``/proc`` on Linux, ``ps`` + ``lsof`` on macOS, best effort). Idle = newest of last commit, dir and
   dirty-file mtimes. 4. ``state`` (repo_state.py) and the worktree cap (> 3 linked: attention line) go to the status file.
"""

from __future__ import annotations

import contextlib
from pathlib import Path

import auto_return
import local_servers
import repo_state
import repo_sync
from session_sync import Clock, git, out

MESS_SECONDS, PUSH_MAX, PUSH_SECONDS, PER_KIND = 40.0, 10, 10.0, 3  # 40 s: +15 s for auto_return's fetch, merge and push
WT_IDLE, WT_ASK, MERGED_IDLE, DIRTY_AFTER = 3 * 86400, 14 * 86400, 86400, 24 * 3600


def mtime(path: Path) -> float:
    try:
        return path.lstat().st_mtime
    except OSError:
        return 0.0


def push_branches(top: Path, clock: Clock, integration: str, env: dict, text: str) -> tuple[int, list[str]]:
    if str(env.get("EPICSPINE_PUSH_BRANCHES", "")).strip().lower() == "off" or (repo_sync.field(text, "Push branches") or "").lower() == "off":
        return 0, []
    pushed, notes = 0, []
    for name in (out(git(["for-each-ref", "--format=%(refname:short)", "refs/heads"], top, clock, 4)) or "").split():
        if name == integration or name.startswith("-") or pushed >= PUSH_MAX:
            continue
        ref, remote = f"refs/heads/{name}", f"refs/remotes/origin/{name}"
        new = out(git(["rev-list", "--count", ref, "--not", "--remotes=origin"], top, clock, 4))
        if not new or not new.isdigit() or int(new) == 0:
            continue
        known, descends = git(["rev-parse", "--verify", "-q", remote], top, clock, 3), git(["merge-base", "--is-ancestor", remote, ref], top, clock, 3)
        if known is not None and known.returncode == 0 and descends is not None and descends.returncode == 1:
            notes.append(f"{top.name}: branch {name} has {new} commit(s) only on this machine and origin/{name} diverged — merge or rebase it, then push (never force)")
            continue
        upstream = out(git(["config", "--get", f"branch.{name}.remote"], top, clock, 3))
        proc = git(["push", "--quiet", *([] if upstream else ["-u"]), "origin", f"{ref}:{ref}"], top, clock, PUSH_SECONDS)
        if proc is not None and proc.returncode == 0:
            pushed += 1
        elif proc is not None:
            notes.append(f"{top.name}: branch {name} has {new} commit(s) only on this machine and the push was rejected — merge or rebase it with origin/{name}, never force")
    return pushed, notes


def linked_worktrees(top: Path, clock: Clock) -> list[tuple[Path, str]]:
    """(path, branch) of every linked worktree that exists on disk (the first ``git worktree list`` entry is the primary)."""
    found = []
    for block in (out(git(["worktree", "list", "--porcelain"], top, clock, 4)) or "").split("\n\n")[1:]:
        info = dict(line.partition(" ")[::2] for line in block.splitlines())
        if "worktree" in info and "prunable" not in info and Path(info["worktree"]).is_dir():
            found.append((Path(info["worktree"]), info.get("branch", "").removeprefix("refs/heads/") or "detached"))
    return found


def changed(top: Path, clock: Clock, *flags: str) -> list[str] | None:
    """Paths from ``git status --porcelain`` (None when git failed); ``out()`` would strip the first line's leading space."""
    proc = git(["status", "--porcelain", *flags], top, clock, 4)
    return None if proc is None or proc.returncode else [line[3:].split(" -> ")[-1].strip('"') for line in proc.stdout.splitlines() if len(line) > 3]


def worktree_lines(top: Path, clock: Clock, integration: str, now: float, trees: list[tuple[Path, str]]) -> list[str]:
    base = f"origin/{integration}"
    if out(git(["rev-parse", "--verify", "-q", base], top, clock, 3)) is None:
        return []
    lines = []
    for path, branch in trees:
        files = changed(path, clock)
        stamp = out(git(["log", "-1", "--format=%ct", "HEAD"], path, clock, 3))
        merged = git(["merge-base", "--is-ancestor", "HEAD", base], path, clock, 3)
        if out(git(["tag", "--contains", "HEAD", "--list", "archive/*"], path, clock, 3)):
            continue
        if files is None or merged is None or not (stamp or "").isdigit():
            continue
        idle = now - max(int(stamp), mtime(path), *(mtime(path / f) for f in files[:50]))
        if merged.returncode == 0:
            if not files and idle > MERGED_IDLE:
                lines.append(f"{top.name}: worktree {path} already merged — safe to remove (git worktree remove {path})")
        elif idle > WT_IDLE:
            ask = f" — {auto_return.PARK}" if idle >= WT_ASK else " — merge it or remove it"
            lines.append(f"{top.name}: worktree {path} ({branch}) idle {int(idle // 86400)}d, not merged{ask}")
    return capped(lines, top.name, "worktrees")


def dirty_line(top: Path, clock: Clock, now: float, since: float | None) -> tuple[list[str], float | None]:
    """Tracked uncommitted changes in the main checkout; ``since`` = when an earlier run first saw it dirty."""
    files = changed(top, clock, "--untracked-files=no")
    if not files:
        return [], None
    since = since or now
    hours = int((now - min([since, *(m for f in files if (m := mtime(top / f)))])) // 3600)
    shown = ", ".join(files[:3]) + (f" +{len(files) - 3} more" if len(files) > 3 else "")
    return ([f"{top.name}: uncommitted changes for {hours}h in {shown} — commit them or discard"] if hours * 3600 >= DIRTY_AFTER else []), since


def capped(lines: list[str], name: str, what: str) -> list[str]:
    return lines[:PER_KIND] + ([f"{name}: {len(lines) - PER_KIND} more {what} (see git worktree list, ps)"] if len(lines) > PER_KIND else [])


def guard(top: Path, clock: Clock, env: dict, now: float, procs: list[local_servers.Proc], previous: dict, online: bool = True) -> dict:
    """Push local-only branches, then report; each part is isolated so one failure never hides the rest."""
    result: dict = {"branches_pushed": 0, "attention": [], "mess": [], "dirty_since": None, "auto": [], "state": {}}
    text, integration, trees = "", "main", []
    with contextlib.suppress(Exception):
        text = repo_sync.repo_text(top, repo_sync.find_spine(top, clock))
        integration = repo_sync.integration_branch(top, clock, text)
        trees = linked_worktrees(top, clock)
    with contextlib.suppress(Exception):
        result["branches_pushed"], result["attention"] = push_branches(top, clock, integration, env, text)
    with contextlib.suppress(Exception):
        back = auto_return.run(top, clock, env, text, integration, trees, now) if online else {"auto": [], "mess": [], "gone": []}
        result["auto"], result["mess"] = back["auto"], back["mess"]
        trees = [t for t in trees if t[0] not in back["gone"]]
    with contextlib.suppress(Exception):
        result["state"] = repo_state.collect(top, clock, integration, trees)
        if cap := repo_state.cap_line(top.name, len(trees)):
            result["attention"].append(cap)
    with contextlib.suppress(Exception):
        result["mess"] += worktree_lines(top, clock, integration, now, trees)
    with contextlib.suppress(Exception):
        lines, result["dirty_since"] = dirty_line(top, clock, now, previous.get("dirty_since"))
        result["mess"] += lines
    with contextlib.suppress(Exception):
        result["mess"] += capped(local_servers.server_lines(top.name, [p for p, _ in trees], procs), top.name, "servers")
    return result
