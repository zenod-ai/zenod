#!/usr/bin/env python3
"""SessionStart repo steps (called by session_sync.run): keep the current git repo in sync and set up.

1. sync: fetch origin; clean + only behind -> fast-forward; ahead on the integration branch -> push
   (fast-forward only; never under ``Integration policy: pr-approval``); diverged or dirty-and-behind on
   the integration branch -> change nothing and return an ``EpicSpine attention:`` line.
2. install: a repo without a current AGENTS.md EpicSpine block gets one (agents_block.py install), and a
   root spine without ``## Operating Learnings`` gets an empty section. Both stay uncommitted; one line
   asks the agent to commit them per Integration policy. A repo with no root spine (or an ambiguous one)
   but an origin gets the block with ``Root spine: none``; ambiguous also adds an attention line.
3. vendored skill: an old copy of the epic-spine skill inside the repo gets an ``EpicSpine attention:`` line
   (vendored_skill.py; report only).
Opt-out: a ``.epicspine-off`` file or an ``EpicSpine: off`` line in AGENTS.md skips both steps (and the
Stop-hook push). Stdlib only; never raises.
"""

from __future__ import annotations

import contextlib
import io
import re
from pathlib import Path

import vendored_skill
from session_sync import SKILL_DIR, Clock, git, out

LEARNINGS = ("## Operating Learnings\n\n**Always** (every task; read in full at bind):\n\n- (none yet)\n\n"
             "**Scoped index** (follow only when the trigger matches):\n\n- (none yet)\n\n")
LEARNINGS_RE = re.compile(r"^## Operating Learnings[ \t]*$", re.MULTILINE)
STATE_RE = re.compile(r"^## Current State[ \t]*$", re.MULTILINE)
FIELD = r"^[ \t>*_-]*{}[*_ ]*:[*_ \t`]*([^\s`*]+)"
BUSY = ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply")
NAMED = re.compile(r"(?i)(epic|spine)")


def field(text: str, name: str) -> str | None:
    match = re.search(FIELD.format(name), text, re.MULTILINE | re.IGNORECASE)
    return match.group(1) if match else None


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def repo_text(top: Path, spine: Path | None = None) -> str:
    return read(top / "AGENTS.md") + "\n" + (read(spine) if spine else "")


def opted_out(top: Path) -> bool:
    return (top / ".epicspine-off").exists() or (field(read(top / "AGENTS.md"), "EpicSpine") or "").lower() == "off"


def integration_branch(top: Path, clock: Clock, text: str) -> str:
    named = field(text, "Integration branch")
    if named:
        return named
    head = out(git(["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"], top, clock, 4)) or ""
    return head.removeprefix("origin/") or ("main" if out(git(["rev-parse", "--verify", "-q", "origin/main"], top, clock, 4)) else "master")


def find_spine(top: Path, clock: Clock) -> Path | None:
    """The root spine: the AGENTS.md block's ``Root spine:`` file if it exists, else the one candidate."""
    block = field(read(top / "AGENTS.md"), "Root spine")
    if block and (top / block.rstrip(".")).is_file():
        return top / block.rstrip(".")
    pick = candidates(top, clock)
    return pick[0] if len(pick) == 1 else None


def candidates(top: Path, clock: Clock) -> list[Path]:
    """Tracked epic/spine-named .md (depth <= 3) with a Current State that is not a child (roots win)."""
    listing = out(git(["ls-files", "*.md"], top, clock, 3)) or ""
    found: list[tuple[bool, Path]] = []
    for rel in listing.splitlines():
        path = Path(rel)
        if len(path.parts) > 3 or not NAMED.search(path.name):
            continue
        text = read(top / rel)
        kind, parent, root = (field(text, n) or "" for n in ("Spine Type", "Parent spine", "Root spine"))
        if not STATE_RE.search(text) or kind.lower() in ("child", "branch", "ticket") or parent.lower() not in ("", "none") \
                or root.lower() not in ("", "self", "none", rel.lower()):
            continue
        found.append((kind.lower() == "root", top / rel))
    return [p for is_root, p in found if is_root] or [p for _, p in found]


def ensure_learnings(spine: Path) -> bool:
    text = read(spine)
    state = STATE_RE.search(text)
    if not state or LEARNINGS_RE.search(text):
        return False
    spine.write_text(text[: state.start()] + LEARNINGS + text[state.start():], encoding="utf-8")
    return True


def install(top: Path, clock: Clock) -> list[str]:
    """AGENTS.md block (``Root spine: none`` without a spine; that needs an origin) + learnings section."""
    import agents_block as ab
    if out(git(["rev-parse", "--git-dir"], top, clock, 3)) != out(git(["rev-parse", "--git-common-dir"], top, clock, 3)):
        return []  # a linked worktree: the primary checkout owns the setup
    spine = find_spine(top, clock)
    if spine is None and out(git(["remote", "get-url", "origin"], top, clock, 3)) is None:
        return []
    want = spine.relative_to(top).as_posix() if spine else "none"
    did: list[str] = []
    try:
        old = ab.BLOCK_RE.search(read(top / "AGENTS.md"))
        have = ab.ROOT_RE.search(old.group(0)) if old else None
        with contextlib.redirect_stdout(io.StringIO()):
            if ab.check(top) != 0 or (have and have.group(1) != want):
                ab.install(top, want)
                did.append("AGENTS.md block" + ("" if spine else " (Root spine: none)"))
    except (Exception, SystemExit):
        pass
    if spine and ensure_learnings(spine):
        did.append(f"Operating Learnings in {spine.relative_to(top).as_posix()}")
    notes = [f"EpicSpine setup: installed {' and '.join(did)} in {top.name}, uncommitted: commit "
             "them per this repo's Integration policy."] if did else []
    several = [] if spine else candidates(top, clock)
    if len(several) > 1:
        names = ", ".join(p.relative_to(top).as_posix() for p in several)
        notes.append(f"EpicSpine attention: repo {top.name} has several possible root spines ({names}); ask the user which "
                     f"is the root, then run `python3 {ab.SKILL_DIR}/scripts/agents_block.py install --repo . --root-spine <path>`.")
    return notes


def sync(top: Path, clock: Clock, fetch_seconds: float = 5.0, push_seconds: float = 8.0) -> list[str]:
    def run(*args: str, seconds: float = 4.0) -> str | None:
        return out(git(list(args), top, clock, seconds))

    branch = run("symbolic-ref", "--short", "-q", "HEAD")
    if not branch or run("remote", "get-url", "origin") is None or run("fetch", "--quiet", "origin", seconds=fetch_seconds) is None:
        return []
    if any((top / (run("rev-parse", "--git-path", name) or "-")).exists() for name in BUSY):
        return []
    counts = (run("rev-list", "--left-right", "--count", f"HEAD...origin/{branch}") or "").split()
    if len(counts) != 2 or counts == ["0", "0"]:
        return []
    ahead, behind = int(counts[0]), int(counts[1])
    spine = find_spine(top, clock)
    text = repo_text(top, spine)
    integration = integration_branch(top, clock, text)
    mine, dirty = branch == integration, bool(run("status", "--porcelain", "--untracked-files=no"))
    name = top.name

    def attention(why: str) -> list[str]:
        return [f"EpicSpine attention: repo {name} ({branch}) needs the user: {why}. Tell the user exactly this; "
                "do not merge, rebase or push it yourself."]

    if ahead == 0:
        if dirty:
            return attention(f"{behind} commit(s) behind origin/{branch} and the working tree has uncommitted changes") if mine else []
        done = run("merge", "--ff-only", "--quiet", f"origin/{branch}", seconds=6) is not None
        return [f"EpicSpine sync: repo {name} {branch} fast-forwarded {behind} commit(s)"] if done else []
    if not mine:
        return []
    if behind:
        return attention(f"{branch} diverged from origin/{branch} ({ahead} ahead, {behind} behind)")
    if (field(text, "Integration policy") or "").lower() == "pr-approval":
        return attention(f"{ahead} unpushed commit(s) on {branch} but Integration policy is pr-approval")
    pushed = git(["push", "--quiet", "origin", branch], top, clock, push_seconds)
    if pushed is not None and pushed.returncode == 0:
        return [f"EpicSpine sync: repo {name} pushed {ahead} commit(s) to origin/{branch}"]
    return attention(f"{ahead} unpushed commit(s) on {branch} and the push failed")


def run(cwd: Path, clock: Clock, home: Path | None = None, skill_dir: Path = SKILL_DIR) -> list[str]:
    notes: list[str] = []
    top = out(git(["rev-parse", "--show-toplevel"], cwd, clock, 3))
    if not top or opted_out(Path(top)):
        return notes
    steps = (lambda: sync(Path(top), clock), lambda: install(Path(top), clock),
             lambda: vendored_skill.check(Path(top), clock, home or Path.home(), skill_dir))
    for step in steps:
        with contextlib.suppress(Exception):
            notes += step()
    return notes
