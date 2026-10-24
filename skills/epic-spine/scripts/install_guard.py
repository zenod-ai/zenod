#!/usr/bin/env python3
"""Guards for everything the installer writes into user-level config (global_install.py, rehook.py, agents_block.py).

1. ``install_dir``: pointers, hook commands and the skill link must name a path that outlives a task, never a linked
   git worktree (a dir whose ``.git`` is a FILE with ``gitdir: <main>/.git/worktrees/<name>``). From a worktree the
   same skill dir in the repo's main checkout is used, else ``~/.agents/skills/epic-spine``, else None (skip, warn).
2. ``inside``: a config dir outside ``$HOME`` is never modified (a mixed env: a real ``CLAUDE_CONFIG_DIR`` leaked
   into a process whose HOME points at a sandbox, or the reverse).
Stdlib only, Python 3.10+.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

FALLBACK = Path(".agents") / "skills" / "epic-spine"
MARKER = Path("assets") / "global-block.md"


def warn(message: str) -> None:
    print(f"epicspine: {message}", file=sys.stderr)


def worktree_of(path: Path) -> tuple[Path, Path | None] | None:
    """(worktree root, main checkout or None) when ``path`` lies in a linked worktree; None otherwise (a plain
    checkout, a submodule, no git). The main checkout is None when it cannot be derived (bare repo)."""
    for top in (path, *path.parents):
        dotgit = top / ".git"
        if dotgit.is_dir():
            return None
        if dotgit.is_file():
            try:
                gitdir = Path(dotgit.read_text(encoding="utf-8").split("gitdir:", 1)[1].strip().splitlines()[0])
            except (OSError, IndexError):
                return None
            gitdir = gitdir if gitdir.is_absolute() else (top / gitdir)
            common = gitdir.resolve().parent.parent
            if gitdir.resolve().parent.name != "worktrees":  # a submodule's .git file: not a linked worktree
                return None
            return top, (common.parent if common.name == ".git" else None)
    return None


_SEEN: set[str] = set()


def once(message: str) -> None:
    """Warn once per distinct message per process (hooks must stay quiet otherwise)."""
    if message not in _SEEN:
        _SEEN.add(message)
        warn(message)


def install_dir(skill_dir: Path, home: Path | None = None, report: bool = True) -> Path | None:
    """The durable skill dir to write into user-level config for ``skill_dir`` (its real path), or None."""
    found = worktree_of(skill_dir)
    if found is None:
        return skill_dir
    root, main = found
    if main is not None:
        candidate = main / skill_dir.relative_to(root)
        if (candidate / MARKER).is_file() and worktree_of(candidate) is None:
            return candidate
    fallback = (home or Path.home()) / FALLBACK
    if (fallback / MARKER).is_file() and worktree_of(fallback.resolve()) is None:
        return fallback
    if report:
        once(f"skill dir {skill_dir} is inside a git worktree ({root}) with no main checkout copy or {fallback}; "
             "nothing written (run the install from the main checkout)")
    return None


def inside(path: Path, home: Path) -> bool:
    """True when ``path`` is ``home`` or below it (symlinks resolved on both sides)."""
    try:
        Path(os.path.realpath(path)).relative_to(os.path.realpath(home))
        return True
    except ValueError:
        return False


TEMP = Path(os.path.realpath(tempfile.gettempdir()))


def outside_home(path: Path, home: Path | None = None) -> bool:
    """True (with one warning) when ``path`` is outside ``$HOME`` (a mixed env: a real config dir leaked into a process
    whose HOME is a sandbox): never modified. A path under the system temp dir is never a real user dir, so it passes."""
    base = home or (Path(os.environ["HOME"]) if os.environ.get("HOME") else None)
    if base is None or inside(path, base) or inside(path, TEMP):
        return False
    once(f"not modifying {path}: outside HOME ({base})")
    return True
