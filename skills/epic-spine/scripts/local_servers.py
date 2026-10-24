#!/usr/bin/env python3
"""Server-like local processes for local_mess.py: ``/proc`` on Linux, ``ps`` + ``lsof`` on macOS (best effort, bounded)."""

from __future__ import annotations

import contextlib
import os
import re
import shlex
import subprocess
from pathlib import Path
from typing import Callable, NamedTuple

SERVER_AFTER = 24 * 3600
PROC = Path("/proc")
SERVER_RE = re.compile(r"(?:^|\s)(?:\S*/)?(?:http\.server|SimpleHTTPServer|http-server|live-server|serve|httpd)(?:\s|$)|\bphp\b.* -S ")


class Proc(NamedTuple):
    pid: int
    cwd: str
    args: list[str]
    age: float  # seconds running


def serving_dir(proc: Proc) -> str:
    args = proc.args
    for i, arg in enumerate(args):
        value = arg.split("=", 1)[1] if arg.startswith("--directory=") else args[i + 1] if arg in ("-d", "--directory") and i + 1 < len(args) else None
        if value:
            return os.path.realpath(os.path.join(proc.cwd, value))
    return os.path.realpath(proc.cwd)


def server_lines(name: str, paths: list[Path], procs: list[Proc]) -> list[str]:
    roots, lines = [p.resolve() for p in paths], []
    for proc in procs:
        if proc.age < SERVER_AFTER or not SERVER_RE.search(" ".join(proc.args)):
            continue
        where = Path(serving_dir(proc))
        if any(where == r or r in where.parents for r in roots):
            lines.append(f"{name}: http server pid {proc.pid} serving {where} for {max(1, int(proc.age // 86400))}d — stop it when done")
    return lines


def parse_etime(text: str) -> float:
    """``[[dd-]hh:]mm:ss`` (ps etime) in seconds."""
    days, _, rest = text.rpartition("-")
    parts = [int(p) for p in rest.split(":")]
    secs = 0
    for part in parts:
        secs = secs * 60 + part
    return float(secs + int(days or 0) * 86400)


def scan_proc(root: Path, now: float, hz: int | None = None) -> list[Proc]:
    hz = hz or os.sysconf("SC_CLK_TCK")
    boot = next(int(line.split()[1]) for line in (root / "stat").read_text().splitlines() if line.startswith("btime"))
    found = []
    for entry in root.iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        try:
            args = [a for a in (entry / "cmdline").read_bytes().decode(errors="replace").split("\0") if a]
            if not SERVER_RE.search(" ".join(args)):
                continue
            started = boot + int((entry / "stat").read_text().rsplit(")", 1)[1].split()[19]) / hz
            found.append(Proc(int(entry.name), os.readlink(entry / "cwd"), args, now - started))
        except (OSError, ValueError, IndexError):
            continue
    return found


def run_cmd(cmd: list[str], seconds: float = 8.0) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=seconds).stdout
    except (subprocess.TimeoutExpired, OSError):
        return ""


def scan_ps(run: Callable[[list[str]], str]) -> list[Proc]:
    """macOS best effort: ``ps`` for age and args, ``lsof -d cwd`` only for the long-running server-like pids."""
    cand = {}
    for line in run(["ps", "-axo", "pid=,etime=,args="]).splitlines():
        parts = line.split(None, 2)
        with contextlib.suppress(ValueError):
            if len(parts) == 3 and parts[0].isdigit() and SERVER_RE.search(parts[2]) and parse_etime(parts[1]) >= SERVER_AFTER:
                cand[int(parts[0])] = (parse_etime(parts[1]), parts[2])
    if not cand:
        return []
    cwds, pid = {}, 0
    for line in run(["lsof", "-a", "-d", "cwd", "-Fpn", "-p", ",".join(map(str, cand))]).splitlines():
        if line.startswith("p") and line[1:].isdigit():
            pid = int(line[1:])
        elif line.startswith("n") and pid:
            cwds[pid] = line[1:]
    return [Proc(pid, cwds[pid], shlex.split(args) if "'" in args or '"' in args else args.split(), age) for pid, (age, args) in cand.items() if pid in cwds]


def scan(now: float, root: Path = PROC, run: Callable[[list[str]], str] = run_cmd) -> list[Proc]:
    """Server-like processes (Linux ``/proc`` under ``root``, else ps/lsof via ``run``); [] on any failure."""
    try:
        return scan_proc(root, now) if (root / "stat").is_file() else scan_ps(run)
    except Exception:
        return []
