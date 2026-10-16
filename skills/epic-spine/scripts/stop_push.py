#!/usr/bin/env python3
"""Stop hook (Claude Code and Codex): at the end of every agent turn, push the repo's committed work.

In the current git repo, when the checked-out branch is the integration branch, ahead of its
``origin/<branch>`` (local ref, no fetch), not behind, and the tracked tree is clean (untracked files are
fine), run ``git push origin <branch>``: fast-forward only, never forced, never under
``Integration policy: pr-approval``. It never commits anything (that stays the agent's job), never prints,
never blocks the turn (always exit 0) and stays inside ~8 s. Network use is throttled by a stamp per repo
(``~/.agents/epicspine-push/<hash>``: time + HEAD): the same HEAD is not retried within 60 s. A diverged or
rejected push is silent here; the next SessionStart reports it as an ``EpicSpine attention:`` line.
Opt out: ``EPICSPINE_SYNC=off``, a ``.epicspine-off`` file, or an ``EpicSpine: off`` line in AGENTS.md.
Stdlib only, Python 3.10+.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from session_sync import Clock, git, out  # noqa: E402
import repo_sync  # noqa: E402

TOTAL_SECONDS = 8.0
THROTTLE_SECONDS = 60.0


def throttled(home: Path, top: Path, head: str, now: float) -> bool:
    """True when this HEAD of this repo was pushed (or tried) < 60 s ago; otherwise re-stamp and say False."""
    stamp = home / ".agents" / "epicspine-push" / hashlib.sha1(str(top).encode()).hexdigest()[:16]
    try:
        when, last = stamp.read_text().split()
        if last == head and now - float(when) < THROTTLE_SECONDS:
            return True
    except (OSError, ValueError):
        pass
    try:
        stamp.parent.mkdir(parents=True, exist_ok=True)
        stamp.write_text(f"{now} {head}")
    except OSError:
        pass
    return False


def push(cwd: Path, clock: Clock, home: Path, now: float | None = None) -> str | None:
    """Push the integration branch when it is safe; returns ``pushed`` / ``failed`` or None (nothing to do)."""
    top = out(git(["rev-parse", "--show-toplevel"], cwd, clock, 3))
    if not top or repo_sync.opted_out(Path(top)):
        return None
    top = Path(top)

    def run(*args: str, seconds: float = 3.0) -> str | None:
        return out(git(list(args), top, clock, seconds))

    branch = run("symbolic-ref", "--short", "-q", "HEAD")
    counts = (run("rev-list", "--left-right", "--count", f"HEAD...origin/{branch}") or "").split() if branch else []
    if len(counts) != 2 or counts[0] == "0" or counts[1] != "0":
        return None
    if any((top / (run("rev-parse", "--git-path", name) or "-")).exists() for name in repo_sync.BUSY):
        return None
    text = repo_sync.repo_text(top, repo_sync.find_spine(top, clock))
    if (repo_sync.field(text, "Integration policy") or "").lower() == "pr-approval" \
            or branch != repo_sync.integration_branch(top, clock, text) or run("status", "--porcelain", "--untracked-files=no") != "":
        return None
    head = run("rev-parse", "HEAD") or ""
    if not head or throttled(home, top, head, now if now is not None else time.time()):
        return None
    done = git(["push", "--quiet", "origin", branch], top, clock, 6)
    return "pushed" if done is not None and done.returncode == 0 else "failed"


def main() -> int:
    try:
        if os.environ.get("EPICSPINE_SYNC", "").strip().lower() == "off":
            return 0
        try:
            payload = json.loads(sys.stdin.read() or "{}")
        except ValueError:
            payload = {}
        cwd = payload.get("cwd") if isinstance(payload, dict) else None
        push(Path(cwd) if cwd and Path(cwd).is_dir() else Path.cwd(), Clock(TOTAL_SECONDS), Path.home())
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
