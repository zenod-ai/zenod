#!/usr/bin/env python3
"""SessionStart check (called by repo_sync.run): old vendored copies of the epic-spine skill inside the repo.

Repo text outranks the live skill, so a copy of the skill checked into a repo keeps steering agents with the rules
it had when it was vendored (2026-10-16: zenod still named DeepSeek that way). A directory under the repo root
(depth <= 4, bounded count and time; not .git, node_modules, worktrees or nested repos) holding a SKILL.md whose
frontmatter name is epic-spine plus a VERSION older than the installed skill's gets one ``EpicSpine attention:``
line. Report only; nothing is changed. Throttled per repo (10 minutes) like the skill sync. Stdlib only; never raises.
"""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path

from session_sync import Clock, due, read_version

SKILL_NAME_RE = re.compile(r"\A---[ \t]*\n(?:[^\n]*\n){0,30}?name:[ \t]*epic-spine[ \t]*\n", re.IGNORECASE)
SKIP_DIRS = {".git", "node_modules", "wt", "worktrees", ".worktrees", "__pycache__"}
DEPTH, MAX_DIRS, MAX_LINES = 4, 4000, 3


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def version_key(version: str) -> tuple[int, ...] | None:
    try:
        return tuple(int(part) for part in version.strip().split("."))
    except ValueError:
        return None


def copies(top: Path, clock: Clock, skill_dir: Path) -> list[Path]:
    """Dirs under ``top`` (depth <= 4, bounded count and time) holding an epic-spine SKILL.md and a VERSION."""
    found: list[Path] = []
    seen, installed = 0, skill_dir.resolve()
    for root, dirs, files in os.walk(top):
        seen += 1
        here = Path(root)
        depth = len(here.relative_to(top).parts)
        if seen > MAX_DIRS or not clock.ok():
            break
        # prune: skipped names, nested repos / linked worktrees (their own .git), and the depth limit
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not (here / d / ".git").exists()] if depth < DEPTH else []
        if "SKILL.md" in files and "VERSION" in files and here.resolve() != installed \
                and SKILL_NAME_RE.match(read(here / "SKILL.md")[:2000]):
            found.append(here)
    return sorted(found)


def check(top: Path, clock: Clock, home: Path, skill_dir: Path, throttle: bool = True) -> list[str]:
    """One attention line per vendored epic-spine copy older than the installed skill (``throttle=False``: always look)."""
    want = version_key(read_version(skill_dir))
    stamp = f".agents/epicspine-vendored/{hashlib.sha1(str(top).encode()).hexdigest()[:12]}.stamp"
    if want is None or (throttle and not due(home, name=stamp)):
        return []
    installed, notes = read_version(skill_dir), []
    for copy in copies(top, clock, skill_dir):
        have = version_key(read_version(copy))
        if have is not None and have < want:
            notes.append(f"EpicSpine attention: {top.name}: old copy of the epic-spine skill at {copy.relative_to(top).as_posix()} "
                         f"({read_version(copy)}, installed {installed}); agents reading it get stale rules — update or remove it")
    return notes[:MAX_LINES]
