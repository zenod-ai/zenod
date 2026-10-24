#!/usr/bin/env python3
"""SessionStart self-sync: keep the skill, the machine dispatch profile and the current repo current.

Called by the SessionStart hook (``global_install.hook_payload``); returns one-line notes for the
hook's additionalContext. Stdlib only, Python 3.10+. Contract: never raises, never blocks (one overall
deadline, every git call short-timeout), never forces (ff-only, no force push, no dirty-tree writes).
``EPICSPINE_SYNC=off`` disables everything. Repo steps live in repo_sync.py; background_sync.py (cron/launchd) syncs
every other repo and the hook prints its attention lines.
"""

from __future__ import annotations

import contextlib
import io
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
STAMP = ".agents/epicspine-sync.stamp"
PROFILE = ".agents/epicspine-profile.md"
LOCAL_PROFILE = ".agents/epicspine-profile.local.md"
CANONICAL_PROFILE = SKILL_DIR / "assets" / "epicspine-profile.md"
THROTTLE_SECONDS = 600
TOTAL_SECONDS = 10.0
SKILL_UPDATES_RE = re.compile(r"^Skill updates:[ \t]*(\w+)", re.MULTILINE)


class Clock:
    """One shared deadline; ``cap(n)`` is a per-call timeout that never outlives it."""

    def __init__(self, total: float = TOTAL_SECONDS) -> None:
        self.end = time.monotonic() + total

    def cap(self, seconds: float) -> float:
        return min(seconds, self.end - time.monotonic())

    def ok(self) -> bool:
        return self.cap(1.0) > 0.3


def git(args: list[str], cwd: Path, clock: Clock, seconds: float = 4.0, info: dict | None = None) -> subprocess.CompletedProcess | None:
    """``git`` with no prompts and a deadline-capped timeout; None on timeout, error or no time left.
    Own process group, killed whole on timeout (else fetch-pack/index-pack outlive it); ``info["timeout"]`` is set then."""
    if not clock.ok():
        return None
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C"}
    env.setdefault("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=4")
    try:
        proc = subprocess.Popen(["git", "-c", "http.followRedirects=false", *args], cwd=str(cwd), stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, env=env, start_new_session=True)
        try:
            stdout, stderr = proc.communicate(timeout=clock.cap(seconds))
        except subprocess.TimeoutExpired:
            info is None or info.update(timeout=True)
            os.killpg(proc.pid, signal.SIGKILL)
            proc.communicate(timeout=5)
            return None
        return subprocess.CompletedProcess(proc.args, proc.returncode, stdout, stderr)
    except (subprocess.SubprocessError, OSError):
        return None


def out(proc: subprocess.CompletedProcess | None) -> str | None:
    return proc.stdout.strip() if proc is not None and proc.returncode == 0 else None


def due(home: Path, now: float | None = None, name: str = STAMP) -> bool:
    """Throttle: True (and re-stamp) at most once per THROTTLE_SECONDS (per stamp ``name``)."""
    stamp, now = home / name, now if now is not None else time.time()
    try:
        if now - float(stamp.read_text().strip()) < THROTTLE_SECONDS:
            return False
    except (OSError, ValueError):
        pass
    try:
        stamp.parent.mkdir(parents=True, exist_ok=True)
        stamp.write_text(str(now))
    except OSError:
        pass
    return True


def read_version(skill_dir: Path) -> str:
    try:
        return (skill_dir / "VERSION").read_text(encoding="utf-8").strip() or "?"
    except OSError:
        return "?"


def sync_checkout(skill_dir: Path, clock: Clock) -> str | None:
    """Skill dir inside a git work tree (source checkout): fetch, then ff-only when clean and only behind."""
    top = out(git(["rev-parse", "--show-toplevel"], skill_dir, clock, 3))
    if not top or out(git(["remote", "get-url", "origin"], Path(top), clock, 3)) is None:
        return None
    top_dir = Path(top)
    if (top_dir / "skill" / "epic-spine").resolve() != skill_dir:  # a vendored copy is SYNC.md's job, not ours
        return None
    if out(git(["fetch", "--quiet", "origin"], top_dir, clock, 5)) is None or out(git(["status", "--porcelain", "--untracked-files=no"], top_dir, clock, 3)):
        return None
    counts = out(git(["rev-list", "--left-right", "--count", "HEAD...@{u}"], top_dir, clock, 3))
    if not counts or counts.split()[0] != "0" or counts.split()[1] == "0":
        return None
    before = read_version(skill_dir)
    if out(git(["merge", "--ff-only", "--quiet", "@{u}"], top_dir, clock, 5)) is None:
        return None
    after = read_version(skill_dir)
    return f"skill {before} -> {after}" if before != after else f"skill {before} updated ({counts.split()[1]} commits)"


def sync_pinned(skill_dir: Path, clock: Clock) -> str | None:
    """Installed copy with our SOURCE pin (or unpinned): reuse skill_update's upgrade when the remote moved."""
    import skill_update as su
    pin = su.read_pin(su.pin_path(skill_dir))
    if (pin is not None and not su.is_our_pin(pin)) or not (skill_dir / "VERSION").is_file() or not clock.ok():
        return None
    source, ref = (pin or {}).get("source") or su.DEFAULT_SOURCE, su.DEFAULT_REF
    head = out(git(["ls-remote", source, f"refs/heads/{ref}"], skill_dir.parent, clock, 5))
    if not head or (pin and pin.get("commit") == head.split()[0]):
        return None
    before, buf = read_version(skill_dir), io.StringIO()
    args = su.build_parser().parse_args(["upgrade", "--yes", "--source", source, "--ref", ref])
    args.timeout = max(1, int(clock.cap(8)))
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(io.StringIO()):
        code = su.cmd_upgrade(args)
    after = read_version(skill_dir)
    return f"skill {before} -> {after}" if code == 0 and "Upgraded" in buf.getvalue() else None


def sync_skill(skill_dir: Path, clock: Clock) -> str | None:
    inside = any((p / ".git").exists() for p in skill_dir.parents)
    return sync_checkout(skill_dir, clock) if inside else sync_pinned(skill_dir, clock)


def sync_profile(home: Path, canonical: Path = CANONICAL_PROFILE) -> str | None:
    """Make ~/.agents/epicspine-profile.md equal to the canonical profile unless a .local.md override exists."""
    try:
        if (home / LOCAL_PROFILE).exists() or not canonical.is_file():
            return None
        want, target = canonical.read_text(encoding="utf-8"), home / PROFILE
        if target.is_file() and target.read_text(encoding="utf-8") == want:
            return None
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + ".tmp")
        tmp.write_text(want, encoding="utf-8")
        os.replace(tmp, target)
        return "dispatch profile synced"
    except OSError:
        return None


def heal_hooks(env: dict, home: Path, skill_dir: Path, updated: bool) -> str | None:
    """Re-register this machine's harness hooks after a skill update or when they are missing (rehook.py)."""
    import rehook as rh
    return rh.run(env, home, skill_dir, updated)


def skills_blocked(cwd: Path) -> bool:
    """A repo ``Skill updates: off|manual`` line keeps the hook from touching the skill."""
    try:
        text = (cwd / "AGENTS.md").read_text(encoding="utf-8")
    except OSError:
        return False
    match = SKILL_UPDATES_RE.search(text)
    return bool(match and match.group(1).lower() in ("off", "manual"))


def run(env: dict, home: Path | None = None, cwd: Path | None = None, skill_dir: Path = SKILL_DIR,
        clock: Clock | None = None) -> list[str]:
    """All SessionStart sync steps; returns the context lines (empty when nothing happened). Never raises."""
    notes: list[str] = []
    try:
        if str(env.get("EPICSPINE_SYNC", "")).strip().lower() == "off":
            return notes
        home, cwd, clock = home or Path.home(), cwd or Path.cwd(), clock or Clock()
        done: list[str] = []
        steps = (lambda: sync_skill(skill_dir, clock) if due(home) and not skills_blocked(cwd) else None,
                 lambda: sync_profile(home),
                 lambda: heal_hooks(env, home, skill_dir, bool(done and done[0].startswith("skill "))))
        for step in steps:
            with contextlib.suppress(Exception):
                result = step()
                if result:
                    done.append(result)
        if done:
            notes.append("EpicSpine sync: " + "; ".join(done))
        import repo_sync
        notes += repo_sync.run(cwd, clock, home, skill_dir)
        import repo_state
        notes += repo_state.session_lines(cwd, clock)  # `EpicSpine state:` line + worktree cap
        import background_sync
        notes += background_sync.attention_lines(home, cwd)  # repos the machine-wide background sync flagged
    except Exception:
        pass
    return notes
