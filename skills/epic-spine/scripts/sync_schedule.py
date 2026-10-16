#!/usr/bin/env python3
"""Schedule ``background_sync.py`` every 15 minutes: a tagged user-crontab entry (Linux) or a LaunchAgent (macOS).

Installed by ``agents_block.py install-global`` (removed by ``uninstall-global``, reported by ``check-global``) and
re-ensured by rehook.py at session start, so a machine that self-updates gets it without a manual re-run. Only the
real home is scheduled (``--home`` overrides never touch crontab/launchd). Other crontab entries are preserved; a
crontab that cannot be read is never overwritten. ``EPICSPINE_SYNC=off`` skips installing. CLI (used by rehook):
``python3 sync_schedule.py ensure|install|check|uninstall``. Stdlib only; never prompts.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
MARK = "# epicspine-background-sync"
LABEL = "dev.epicspine.sync"
INTERVAL = 900
SYSTEM_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"


def target(skill_dir: Path) -> str:
    return str(skill_dir / "scripts" / "background_sync.py")


def cron_line(skill_dir: Path) -> str:
    return f'*/{INTERVAL // 60} * * * * python3 "{target(skill_dir)}" >/dev/null 2>&1 {MARK}'


def plist_path(home: Path) -> Path:
    return home / "Library" / "LaunchAgents" / f"{LABEL}.plist"


def plist_text(skill_dir: Path) -> str:
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
            '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n'
            f"  <key>Label</key><string>{LABEL}</string>\n  <key>ProgramArguments</key>\n  <array>\n"
            f"    <string>/usr/bin/env</string><string>python3</string><string>{target(skill_dir)}</string>\n  </array>\n"
            f"  <key>StartInterval</key><integer>{INTERVAL}</integer>\n  <key>RunAtLoad</key><true/>\n"
            f"  <key>EnvironmentVariables</key><dict><key>PATH</key><string>{SYSTEM_PATH}</string></dict>\n"
            "</dict>\n</plist>\n")


def run(argv: list[str], text: str | None = None) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(argv, input=text, capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return None


def kind() -> str | None:
    """``launchd`` (macOS with launchctl), ``cron`` (Linux with crontab) or None."""
    from shutil import which
    if sys.platform == "darwin":
        return "launchd" if which("launchctl") else None
    return "cron" if sys.platform.startswith("linux") and which("crontab") else None


def read_cron() -> str | None:
    """The user's crontab text ('' when none yet); None when it cannot be read (then never write)."""
    done = run(["crontab", "-l"])
    if done is None:
        return None
    if done.returncode == 0:
        return done.stdout
    return "" if "no crontab" in (done.stderr + done.stdout).lower() else None


def write_cron(lines: list[str]) -> bool:
    done = run(["crontab", "-"], "\n".join(lines) + "\n" if lines else "")
    return done is not None and done.returncode == 0


def cron_state(skill_dir: Path) -> str:
    text = read_cron()
    if text is None:
        return "unreadable"
    ours = [line for line in text.splitlines() if MARK in line]
    return "missing" if not ours else "current" if ours == [cron_line(skill_dir)] else "stale"


def cron_install(skill_dir: Path) -> str:
    text = read_cron()
    if text is None:
        return "error: cannot read crontab"
    old = text.splitlines()
    new = [line for line in old if MARK not in line] + [cron_line(skill_dir)]
    if old == new:
        return "current"
    return ("updated" if any(MARK in line for line in old) else "installed") if write_cron(new) else "error: crontab write failed"


def cron_remove() -> str:
    text = read_cron()
    if text is None:
        return "error: cannot read crontab"
    old = text.splitlines()
    keep = [line for line in old if MARK not in line]
    if keep == old:
        return "absent"
    return "removed" if write_cron(keep) else "error: crontab write failed"


def loaded() -> bool:
    done = run(["launchctl", "print", f"gui/{os.getuid()}/{LABEL}"])
    return done is not None and done.returncode == 0


def launchd_state(home: Path, skill_dir: Path) -> str:
    path = plist_path(home)
    if not path.is_file():
        return "missing"
    return "stale" if path.read_text(encoding="utf-8") != plist_text(skill_dir) else "current" if loaded() else "not loaded"


def launchd_install(home: Path, skill_dir: Path) -> str:
    path, uid = plist_path(home), os.getuid()
    changed = not path.is_file() or path.read_text(encoding="utf-8") != plist_text(skill_dir)
    if changed:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(plist_text(skill_dir), encoding="utf-8")
        run(["launchctl", "bootout", f"gui/{uid}/{LABEL}"])  # a stale job may be loaded; failure is fine
    elif loaded():
        return "current"
    done = run(["launchctl", "bootstrap", f"gui/{uid}", str(path)])
    if done is None or done.returncode != 0:
        done = run(["launchctl", "load", "-w", str(path)])
    if done is None or done.returncode != 0:
        return f"error: plist written to {path} but launchctl could not load it"
    return "installed" if changed else "loaded"


def launchd_remove(home: Path) -> str:
    path = plist_path(home)
    if run(["launchctl", "bootout", f"gui/{os.getuid()}/{LABEL}"]) is None or loaded():
        run(["launchctl", "unload", "-w", str(path)])
    if not path.is_file():
        return "absent"
    path.unlink()
    return "removed"


def apply(action: str, home: Path, skill_dir: Path = SKILL_DIR, env: dict | None = None) -> tuple[str, int]:
    """``action``: install | check | uninstall (CLI also: ensure). Returns (one-line result, exit code)."""
    env = os.environ if env is None else env
    how = kind()
    if home.resolve() != Path.home().resolve():
        return "skipped (--home override)", 0
    if how is None:
        return "unsupported here (needs crontab on Linux or launchctl on macOS)", 0
    if action in ("install", "ensure"):
        if str(env.get("EPICSPINE_SYNC", "")).strip().lower() == "off":
            return "not installed (EPICSPINE_SYNC=off)", 0
        result = cron_install(skill_dir) if how == "cron" else launchd_install(home, skill_dir)
    elif action == "uninstall":
        result = cron_remove() if how == "cron" else launchd_remove(home)
    else:
        result = cron_state(skill_dir) if how == "cron" else launchd_state(home, skill_dir)
        result = "scheduled" if result == "current" else result
    where = "user crontab" if how == "cron" else str(plist_path(home))
    return f"{result} ({where}, every {INTERVAL // 60} min)", int(result.startswith("error") or (action == "check" and result != "scheduled"))


def main(argv: list[str] | None = None) -> int:
    args = (argv if argv is not None else sys.argv[1:]) or ["check"]
    if args[0] not in ("ensure", "install", "check", "uninstall"):
        print("usage: sync_schedule.py ensure|install|check|uninstall", file=sys.stderr)
        return 2
    line, code = apply(args[0], Path.home())
    print(f"background sync: {line}")
    return code


if __name__ == "__main__":
    sys.exit(main())
