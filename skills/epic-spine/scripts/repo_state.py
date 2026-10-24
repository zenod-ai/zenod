#!/usr/bin/env python3
"""Repo state at a glance (local refs only, bounded): the SessionStart line, the worktree cap, a table of every repo.

``collect`` (called per repo by local_mess.guard, stored in the status file as ``state``) and ``session_lines``
(SessionStart, current repo): ``EpicSpine state: <repo> main clean|dirty(N), in sync|ahead N|behind N · worktrees N ·
branches not in main N``. Dirty = tracked changes in the primary checkout; worktrees = linked ones; branches not in main =
distinct local/origin branch names not merged into ``origin/<integration>``. More than 3 linked worktrees adds
``EpicSpine attention: <repo>: N open worktrees (cap 3) — finish or merge one before starting another``.
``python3 repo_state.py`` prints one row per repo from ``~/.agents/epicspine-sync-status.json`` (written by the background
job): repo | main state | ahead/behind | worktrees | branches not in main | attention. On request only: SessionStart never
shows another repo's state (L-18). Stdlib only; never raises.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import repo_sync  # noqa: E402
from session_sync import Clock, git, out  # noqa: E402

CAP = 3


def collect(top: Path, clock: Clock, integration: str, trees: list) -> dict:
    """Counts for the primary checkout of ``top``'s repo; ``trees`` = its linked worktrees (any sequence)."""
    base = f"origin/{integration}"
    has_origin = out(git(["rev-parse", "--verify", "-q", base], top, clock, 3)) is not None
    first = (out(git(["worktree", "list", "--porcelain"], top, clock, 4)) or "").split("\n\n")[0]
    primary = Path(first.split("\n")[0].removeprefix("worktree ")) if first.startswith("worktree ") else top
    status = git(["status", "--porcelain", "--untracked-files=no"], primary, clock, 4)
    counts = (out(git(["rev-list", "--left-right", "--count", f"{integration}...{base}"], top, clock, 3)) or "").split() if has_origin else []
    refs = out(git(["for-each-ref", "--no-merged", base, "--format=%(refname)", "refs/heads", "refs/remotes/origin"], top, clock, 4)) if has_origin else None
    names = {r.removeprefix("refs/heads/").removeprefix("refs/remotes/origin/") for r in (refs or "").split()}
    return {"integration": integration, "branch": out(git(["symbolic-ref", "--short", "-q", "HEAD"], primary, clock, 3)),
            "dirty": len([ln for ln in status.stdout.splitlines() if ln.strip()]) if status is not None and status.returncode == 0 else None,
            "ahead": int(counts[0]) if len(counts) == 2 else None, "behind": int(counts[1]) if len(counts) == 2 else None,
            "worktrees": len(trees), "unmerged": len(names - {integration, "HEAD"}) if refs is not None else None}


def sync_text(info: dict) -> str:
    ahead, behind = info.get("ahead"), info.get("behind")
    if ahead is None or behind is None:
        return "sync unknown"
    return "in sync" if not (ahead or behind) else ", ".join(p for p in (f"ahead {ahead}" if ahead else "", f"behind {behind}" if behind else "") if p)


def main_text(info: dict) -> str:
    dirty = info.get("dirty")
    return "?" if dirty is None else "clean" if not dirty else f"dirty({dirty})"


def state_line(name: str, info: dict) -> str:
    elsewhere = f" · primary checkout on {info['branch']}" if info.get("branch") not in (None, info.get("integration")) else ""
    return (f"EpicSpine state: {name} {info.get('integration', 'main')} {main_text(info)}, {sync_text(info)} · worktrees "
            f"{info.get('worktrees', '?')} · branches not in main {'?' if info.get('unmerged') is None else info['unmerged']}{elsewhere}")


def cap_line(name: str, worktrees: int) -> str | None:
    return f"{name}: {worktrees} open worktrees (cap {CAP}) — finish or merge one before starting another" if worktrees > CAP else None


def session_lines(cwd: Path, clock: Clock) -> list[str]:
    """SessionStart: the current repo's state line plus the worktree-cap attention line."""
    import local_mess
    top = out(git(["rev-parse", "--show-toplevel"], cwd, clock, 3))
    if not top or repo_sync.opted_out(Path(top)):
        return []
    top_path = Path(top)
    text = repo_sync.repo_text(top_path, repo_sync.find_spine(top_path, clock))
    trees = local_mess.linked_worktrees(top_path, clock)
    info = collect(top_path, clock, repo_sync.integration_branch(top_path, clock, text), trees)
    first = (out(git(["worktree", "list", "--porcelain"], top_path, clock, 4)) or "").split("\n")[0].removeprefix("worktree ")
    name = Path(first).name if first else top_path.name
    cap = cap_line(name, len(trees))
    return [state_line(name, info)] + ([f"EpicSpine attention: {cap}"] if cap else [])


def table(data: dict) -> str:
    rows = [("repo", "main state", "ahead/behind", "worktrees", "not in main", "attention")]
    for top, entry in sorted(data.get("repos", {}).items(), key=lambda kv: kv[1].get("name", kv[0])):
        info = entry.get("state") or {}
        notes = [*entry.get("attention", []), *entry.get("mess", [])]
        ab = "?" if info.get("ahead") is None else f"{info['ahead']}/{info['behind']}"
        cell = "-" if not notes else f"{len(notes)}: {notes[0][:60]}" + ("…" if len(notes[0]) > 60 else "")
        rows.append((entry.get("name", Path(top).name), main_text(info), ab, str(info.get("worktrees", "?")),
                     "?" if info.get("unmerged") is None else str(info["unmerged"]), cell))
    widths = [max(len(r[i]) for r in rows) for i in range(5)]
    return "\n".join("  ".join(c.ljust(w) for c, w in zip(r[:5], widths)) + "  " + r[5] for r in rows)


def main(argv: list[str] | None = None) -> int:
    import argparse
    import background_sync
    parser = argparse.ArgumentParser(description="Table of every repo from the background-sync status file.")
    parser.add_argument("--home", type=Path, default=Path.home(), help="home holding .agents/epicspine-sync-status.json")
    data = background_sync.load(parser.parse_args(argv).home)
    if not data.get("repos"):
        print("no status file yet: the background sync (every 15 min) writes it")
        return 1
    print(f"as of {data.get('updated')} (background sync)\n{table(data)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
