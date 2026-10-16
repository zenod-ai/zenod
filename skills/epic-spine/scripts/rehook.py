#!/usr/bin/env python3
"""SessionStart self-heal of hook registration (called by session_sync.py).

Self-update only swaps code on disk; hooks are registered by ``agents_block.py install-global``. So after a
skill update (and whenever a hook is missing from the config dir this session runs in) re-run that install, for
Claude Code (``CLAUDE_CONFIG_DIR`` or ``~/.claude``) and Codex (``CODEX_HOME`` or ``~/.codex``, only with a
``codex`` binary), as a subprocess of the on-disk (possibly just-updated) script. Only config dirs that already
carry EpicSpine are touched; a hook registered from another checkout is never repointed; the skill dir is this
script's real path, as for install-global. Staleness-triggered runs are throttled.
Also keeps the machine-wide background sync scheduled (``ensure_schedule``; sync_schedule.py).
Bounded (Codex trust asks ``codex app-server``, capped), silent unless something changed, never raises.
"""

from __future__ import annotations

import os
import re
import shutil
import signal
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import global_install as gi  # noqa: E402
from session_sync import due  # noqa: E402

STAMP = ".agents/epicspine-rehook.stamp"
SCHEDULE_STAMP = ".agents/epicspine-sched.stamp"
COMMAND_RE = re.compile(r'python3 "([^"]*agents_block\.py)" print-hook')
LIMITS = {"claude-code": 6.0, "codex": 9.0}  # seconds per subprocess; codex trust itself is capped by CODEX_TRUST_SECONDS
CODEX_TRUST_SECONDS = "5"  # cap on the codex app-server trust lookup inside the subprocess
NAMES = {"stop_push.py": "Stop push", "url_gate.py": "URL gate"}


def targets(env: dict, home: Path):
    """(harness, config dir, hooks file, instruction file, managed Stop scripts) for this machine."""
    cdir = Path(env.get("CLAUDE_CONFIG_DIR") or home / ".claude").expanduser()
    yield "claude-code", cdir, cdir / "settings.json", cdir / "CLAUDE.md", gi.STOPS["claude-code"]
    cx = Path(env.get("CODEX_HOME") or home / ".codex").expanduser()
    if shutil.which("codex"):
        yield "codex", cx, cx / "hooks.json", cx / "AGENTS.md", gi.STOPS["codex"]


def registered(hooks_file: Path) -> Path | None:
    """The agents_block.py path the SessionStart hook runs, if any."""
    for group in gi._load(hooks_file).get("hooks", {}).get("SessionStart", []):
        for hook in group.get("hooks", []):
            match = COMMAND_RE.search(str(hook.get("command", "")))
            if match:
                return Path(match.group(1))
    return None


def missing(hooks_file: Path, stop: tuple[str, ...]) -> list[str]:
    try:
        text = str(gi._load(hooks_file).get("hooks", {}))
    except (ValueError, OSError):
        text = ""
    return [name for name, ok in [("SessionStart", gi.HOOK_MARK in text), *((NAMES.get(s, s), f'{s}"' in text) for s in stop)] if not ok]


def ours(hooks_file: Path, instr: Path) -> bool:
    """EpicSpine already lives here: one of our hooks is registered, or the instruction file has our block."""
    try:
        hooks = str(gi._load(hooks_file).get("hooks", {}))
        return any(m in hooks for m in (gi.HOOK_MARK, gi.GATE_MARK, gi.PUSH_MARK)) or bool(gi.BLOCK_RE.search(instr.read_text(encoding="utf-8")))
    except (ValueError, OSError):
        return False


def snapshot(*paths: Path) -> list[bytes | None]:
    return [p.read_bytes() if p.is_file() else None for p in paths]


def launch(argv: list[str], env: dict, seconds: float) -> bool:
    """Run one subprocess in its own process group; kill the group at the deadline. True iff exit 0."""
    proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, start_new_session=True)
    try:
        return proc.wait(timeout=seconds) == 0
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
        return False


def heal_one(harness: str, cdir: Path, hooks_file: Path, instr: Path, stop: tuple[str, ...], env: dict, home: Path,
             updated: bool, skill_dir: Path) -> str | None:
    if not cdir.is_dir() or not ours(hooks_file, instr):
        return None
    try:
        reg = registered(hooks_file)
    except (ValueError, OSError):
        reg = None
    script = skill_dir / "scripts" / "agents_block.py"
    if reg is not None and reg.is_file() and reg.resolve() != script:
        return None  # another checkout's hook: not ours to repoint
    gone = missing(hooks_file, stop)
    if not (updated or gone) or not (updated or due(home, name=STAMP + "." + harness)):
        return None
    run_env = {**os.environ, **{k: str(v) for k, v in env.items()}, "HOME": str(home), "EPICSPINE_CODEX_SECONDS": CODEX_TRUST_SECONDS}
    for key in ("CLAUDE_CONFIG_DIR", "CODEX_HOME"):
        if key not in env:
            run_env.pop(key, None)
    argv = [sys.executable, "-B", str(script), "install-global", "--only", harness]
    watched = snapshot(hooks_file, cdir / "config.toml")
    if not launch(argv + (["--claude-dir", str(cdir)] if harness == "claude-code" else []), run_env, LIMITS[harness]) \
            or snapshot(hooks_file, cdir / "config.toml") == watched:
        return None
    added = ", ".join(gone) + " added" if gone else "refreshed"
    return added if harness == "claude-code" else f"{harness}: {added}"


def ensure_schedule(env: dict, home: Path, skill_dir: Path, updated: bool) -> str | None:
    """Keep the machine-wide background sync scheduled (sync_schedule.py): missing or stale entry (throttled, local
    check) or after a skill update (the new script re-writes it). Returns a note only when it was not current."""
    import sync_schedule as sched
    if str(env.get("EPICSPINE_SYNC", "")).strip().lower() == "off" or sched.kind() is None or home.resolve() != Path.home().resolve():
        return None
    state = sched.cron_state(skill_dir) if sched.kind() == "cron" else sched.launchd_state(home, skill_dir)
    if state == "unreadable" or (not updated and (state == "current" or not due(home, name=SCHEDULE_STAMP))):
        return None
    launch([sys.executable, "-B", str(skill_dir / "scripts" / "sync_schedule.py"), "ensure"], {**os.environ, "HOME": str(home)}, LIMITS["claude-code"])
    return "background sync scheduled" if state != "current" else None


def run(env: dict, home: Path, skill_dir: Path, updated: bool) -> str | None:
    """One note like ``hooks re-registered (Stop push added)``, or None. Never raises."""
    parts: list[str] = []
    for harness, cdir, hooks_file, instr, stop in targets(env, home):
        try:
            part = heal_one(harness, cdir, hooks_file, instr, stop, env, home, updated, skill_dir)
        except Exception:
            part = None
        if part:
            parts.append(part)
    note = f"hooks re-registered ({'; '.join(parts)})" if parts else None
    try:
        sched = ensure_schedule(env, home, skill_dir, updated)
    except Exception:
        sched = None
    return "; ".join(filter(None, (note, sched))) or None
