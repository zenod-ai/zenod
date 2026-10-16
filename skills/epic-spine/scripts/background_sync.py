#!/usr/bin/env python3
"""Machine-wide background sync (cron/launchd every 15 min; see sync_schedule.py): keep every repo current unattended.

Roots: ``EPICSPINE_REPO_ROOTS`` (os.pathsep list) else ``~/github``, ``~/Documents/GitHub``, ``~/code``, ``~/src``
(existing ones only). Main checkouts at depth <= 2 (linked worktrees and submodules have a ``.git`` file: skipped) with an
``origin`` and a commit (any ref) in the last 90 days; ``.epicspine-off`` / ``EpicSpine: off`` repos are skipped. Per repo,
the SessionStart logic: ``repo_sync.sync`` (fetch, ff-only when clean and behind, push committed integration-branch work
per Integration policy; never force, never commit, never touch dirty files), the pre-commit gate where a spine/AGENTS
block exists (``global_install.ensure_gate``) and the vendored-copy check. No AGENTS.md blocks are installed here (that
would leave uncommitted files). Bounded: 20 s per repo, 5 min total, least recently synced first; no prompts; a flock
lock stops overlap. Writes ``~/.agents/epicspine-sync-status.json``; SessionStart prints ``EpicSpine attention:`` lines
from it for any repo. ``EPICSPINE_SYNC=off`` disables. Silent (cron mail) unless ``-v``. Stdlib only; never raises.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import repo_sync  # noqa: E402
import vendored_skill  # noqa: E402
from session_sync import SKILL_DIR, Clock, git, out, read_version  # noqa: E402

STATUS = ".agents/epicspine-sync-status.json"
LOCK = ".agents/epicspine-sync.lock"
DEFAULT_ROOTS = ("github", "Documents/GitHub", "code", "src")
REPO_SECONDS, TOTAL_SECONDS, DEPTH, MAX_AGE_DAYS = 20.0, 300.0, 2, 90
STALE_SECONDS, SHOWN = 24 * 3600, 5
PATH_EXTRA = ("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin")


def now_iso(when: float | None = None) -> str:
    return datetime.fromtimestamp(when if when is not None else time.time(), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def roots(env: dict, home: Path) -> list[Path]:
    raw = str(env.get("EPICSPINE_REPO_ROOTS") or "")
    found = [Path(p).expanduser() for p in raw.split(os.pathsep) if p.strip()] if raw.strip() else [home / d for d in DEFAULT_ROOTS]
    return [p for p in found if p.is_dir()]


def discover(roots_: list[Path]) -> list[Path]:
    """Main checkouts (``.git`` directory) at depth <= 2 below the roots (or a root that is one), deduplicated."""
    seen: dict[Path, None] = {}

    def walk(path: Path, depth: int) -> None:
        if (path / ".git").is_dir():
            seen.setdefault(path.resolve())
        elif depth < DEPTH:
            try:
                kids = sorted(p for p in path.iterdir() if p.is_dir() and not p.name.startswith("."))
            except OSError:
                return
            for kid in kids:
                walk(kid, depth + 1)

    for root in roots_:
        walk(root, 0)
    return list(seen)


def eligible(top: Path, clock: Clock, now: float) -> bool:
    """Not opted out, has an origin, and a commit on any ref (fetched ones included) in the last 90 days."""
    if repo_sync.opted_out(top) or out(git(["remote", "get-url", "origin"], top, clock, 4)) is None:
        return False
    stamp = out(git(["log", "-1", "--all", "--format=%ct"], top, clock, 4))
    return bool(stamp and stamp.isdigit() and now - int(stamp) <= MAX_AGE_DAYS * 86400)


def counts(top: Path, branch: str | None) -> tuple[int | None, int | None]:
    got = (out(git(["rev-list", "--left-right", "--count", f"HEAD...origin/{branch}"], top, Clock(3), 3)) or "").split() if branch else []
    return (int(got[0]), int(got[1])) if len(got) == 2 else (None, None)


def sync_repo(top: Path, home: Path, skill_dir: Path, total: Clock) -> dict:
    clock = Clock(max(0.0, min(REPO_SECONDS, total.cap(REPO_SECONDS))))
    notes: list[str] = []
    for step in (lambda: repo_sync.sync(top, clock, fetch_seconds=15, push_seconds=15),
                 lambda: vendored_skill.check(top, clock, home, skill_dir, throttle=False)):
        with contextlib.suppress(Exception):
            notes += step()
    with contextlib.suppress(Exception):
        import global_install
        global_install.ensure_gate(top)
    branch = out(git(["symbolic-ref", "--short", "-q", "HEAD"], top, Clock(3), 3))
    ahead, behind = counts(top, branch)
    text = " ".join(notes)
    pulled, pushed = (int(m.group(1)) if m else 0 for m in (re.search(r"fast-forwarded (\d+)", text), re.search(r"pushed (\d+) commit", text)))
    attention = []
    for note in (n for n in notes if n.startswith("EpicSpine attention:")):
        why = re.match(r"EpicSpine attention: repo (\S+) \((.*?)\) needs the user: (.*?)\. Tell the user", note)
        attention.append(f"{why.group(1)} ({why.group(2)}): {why.group(3)}" if why else note.removeprefix("EpicSpine attention: "))
    return {"name": top.name, "last_run": now_iso(), "branch": branch, "ahead": ahead, "behind": behind, "pulled": pulled,
            "pushed": pushed, "timed_out": not clock.ok(), "attention": attention}


def load(home: Path) -> dict:
    try:
        data = json.loads((home / STATUS).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save(home: Path, repos: dict, skill_dir: Path) -> None:
    path = home / STATUS
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps({"version": 1, "updated": now_iso(), "skill": read_version(skill_dir), "repos": repos}, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def run(env: dict, home: Path, skill_dir: Path = SKILL_DIR, verbose: bool = False) -> int:
    if str(env.get("EPICSPINE_SYNC", "")).strip().lower() == "off":
        return 0
    lock = None
    try:
        import fcntl
        (home / LOCK).parent.mkdir(parents=True, exist_ok=True)
        lock = open(home / LOCK, "w")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        return 0  # another run is in progress
    except (ImportError, OSError):
        pass
    os.environ["PATH"] = os.pathsep.join([*os.environ.get("PATH", "").split(os.pathsep), *(p for p in PATH_EXTRA if p not in os.environ.get("PATH", ""))])
    total, previous, repos = Clock(TOTAL_SECONDS), load(home).get("repos", {}), {}
    now = time.time()
    tops = [t for t in discover(roots(env, home)) if eligible(t, Clock(15), now)]
    for top in sorted(tops, key=lambda t: str(previous.get(str(t), {}).get("last_run", ""))):
        if not total.ok():
            if str(top) in previous:
                repos[str(top)] = previous[str(top)]  # out of time: keep the last known entry, retry first next run
            continue
        try:
            repos[str(top)] = sync_repo(top, home, skill_dir, total)
        except Exception as exc:  # one bad repo never stops the rest
            repos[str(top)] = {"name": top.name, "last_run": now_iso(), "attention": [f"{top.name}: background sync failed ({exc})"]}
    with contextlib.suppress(OSError):
        save(home, repos, skill_dir)
    if verbose:
        for top, info in repos.items():
            print(f"{top}: {info.get('branch')} ahead {info.get('ahead')} behind {info.get('behind')} pulled {info.get('pulled')} "
                  f"pushed {info.get('pushed')}" + "".join(f"\n  attention: {a}" for a in info.get("attention", [])))
    if lock:
        lock.close()
    return 0


def attention_lines(home: Path, cwd: Path | None = None, now: float | None = None) -> list[str]:
    """SessionStart: ``EpicSpine attention:`` lines from the status file for any repo but the current one (max 5 + 'N more')."""
    data = load(home)
    if not data:
        return []
    now = now if now is not None else time.time()
    try:
        age = now - datetime.strptime(str(data.get("updated")), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        age = 0.0
    lines = []
    if age > STALE_SECONDS:
        lines.append(f"EpicSpine attention: background sync has not run since {data.get('updated')}; run `python3 "
                     f"{Path(__file__).resolve().with_name('agents_block.py')} check-global` and re-run install-global if its schedule is missing")
    here = (cwd or Path.cwd()).resolve()
    for top, info in sorted(data.get("repos", {}).items()):
        if here == Path(top) or Path(top) in here.parents:
            continue  # the live SessionStart check already covers the current repo
        lines += [f"EpicSpine attention: {a} (background sync; tell the user which repo and why, change nothing)" for a in info.get("attention", [])]
    return lines[:SHOWN] + ([f"EpicSpine attention: {len(lines) - SHOWN} more (see ~/{STATUS})"] if len(lines) > SHOWN else [])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync every repo under the repo roots (see module docstring).")
    parser.add_argument("-v", "--verbose", action="store_true", help="print one line per repo")
    args = parser.parse_args(argv)
    try:
        return run(dict(os.environ), Path.home(), SKILL_DIR, args.verbose)
    except Exception:
        return 0


if __name__ == "__main__":
    sys.exit(main())
