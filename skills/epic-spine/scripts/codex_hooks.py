#!/usr/bin/env python3
"""Codex hook trust for ``install-global`` (Codex CLI 0.131+ runs ``$CODEX_HOME/hooks.json`` hooks).

Codex only runs a user hook once it is trusted: ``config.toml`` needs
``[hooks.state."<hooks.json>:<event>:<i>:<j>"] trusted_hash = "<sha256 of the hook>"``. The hash is
Codex's own, so we ask the installed ``codex app-server`` (``hooks/list``, JSON-RPC over stdio, offline)
for each EpicSpine hook's ``currentHash`` and write exactly those entries, in one managed block of
``config.toml`` (removed again by uninstall). Foreign hooks are never trusted for the user. No ``codex``
binary or no answer: nothing is written and the hooks stay "needs review" (Codex ``/hooks``), so the
pointer in ``AGENTS.md`` still tells the agent to run ``print-hook`` first. Stdlib only; never raises.
"""

from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

BEGIN = "# epicspine:begin hooks-trust (managed by agents_block.py install-global)"
END = "# epicspine:end hooks-trust"
BLOCK_RE = re.compile(rf"^{re.escape(BEGIN)}\n.*?^{re.escape(END)}\n?", re.MULTILINE | re.DOTALL)
TABLE_RE = re.compile(r'^\[hooks\.state\.(?:"((?:[^"\\]|\\.)*)"|\'([^\']*)\')\][ \t]*(?:#.*)?$')


def list_hooks(codex_dir: Path, seconds: float | None = None) -> list[dict] | None:
    """Every hook Codex discovers for ``codex_dir`` (key, command, sourcePath, currentHash, trustStatus), or None."""
    exe = shutil.which("codex")
    if not exe:
        return None
    seconds = seconds or float(os.environ.get("EPICSPINE_CODEX_SECONDS") or 20.0)  # the SessionStart self-heal caps this
    msgs = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"clientInfo": {"name": "epicspine", "version": "1"}}},
            {"jsonrpc": "2.0", "method": "initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "hooks/list", "params": {"cwds": [str(codex_dir)]}}]
    try:
        proc = subprocess.Popen([exe, "app-server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                text=True, env={**os.environ, "CODEX_HOME": str(codex_dir)})
    except OSError:
        return None
    lines: queue.Queue = queue.Queue()
    threading.Thread(target=lambda: [lines.put(line) for line in proc.stdout], daemon=True).start()
    try:
        proc.stdin.write("".join(json.dumps(m) + "\n" for m in msgs))
        proc.stdin.flush()
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            try:
                reply = json.loads(lines.get(timeout=0.5))
            except queue.Empty:
                continue
            except ValueError:
                continue
            if reply.get("id") == 2:
                data = (reply.get("result") or {}).get("data") or []
                return [h for entry in data for h in entry.get("hooks", [])]
    except (OSError, ValueError):
        pass
    finally:
        for stop in (lambda: proc.stdin.close(), proc.terminate, lambda: proc.wait(3), proc.kill, lambda: proc.wait(3), proc.stdout.close):
            try:
                stop()
            except (OSError, ValueError, subprocess.TimeoutExpired):
                pass
    return None


def _strip(text: str, keys: set[str]) -> str:
    """Drop our managed block and any hooks.state table whose key we are about to rewrite."""
    text, kept, skipping = BLOCK_RE.sub("", text), [], False
    for line in text.splitlines(keepends=True):
        table = TABLE_RE.match(line.rstrip("\n"))
        if line.lstrip().startswith("["):
            skipping = bool(table and (json.loads(f'"{table.group(1)}"') if table.group(1) is not None else table.group(2)) in keys)
        if not skipping:
            kept.append(line)
    return "".join(kept)


def sync_trust(codex_dir: Path, hooks_file: Path, marks: tuple[str, ...], on: bool) -> str:
    """Install: trust our hooks listed by Codex. Uninstall (``on`` False): remove the managed block."""
    config = codex_dir / "config.toml"
    try:
        old = config.read_text(encoding="utf-8") if config.is_file() else ""
        keys: dict[str, str] = {}
        if on:
            found = list_hooks(codex_dir)
            if found is None:
                return "registered; trust not set (no codex app-server answer): approve once in Codex /hooks"
            keys = {h["key"]: h["currentHash"] for h in found if h.get("currentHash") and os.path.realpath(h.get("sourcePath", "")) == os.path.realpath(hooks_file)
                    and any(mark in str(h.get("command", "")) for mark in marks)}
        new = _strip(old, set(keys)).rstrip("\n")
        if keys:
            body = "\n".join(f"[hooks.state.{json.dumps(key)}]\ntrusted_hash = {json.dumps(digest)}" for key, digest in sorted(keys.items()))
            new = (new + "\n\n" if new else "") + f"{BEGIN}\n{body}\n{END}"
        new = new + "\n" if new else ""
        if new == old:
            return "trust current" if keys else "trust absent"
        if new:
            codex_dir.mkdir(parents=True, exist_ok=True)
            config.write_text(new, encoding="utf-8")
        else:
            config.unlink(missing_ok=True)
        return f"trusted {len(keys)} hook(s)" if keys else "trust removed"
    except (OSError, ValueError, KeyError) as exc:
        return f"error: trust not written: {exc}"


def trust_present(codex_dir: Path) -> bool:
    try:
        return bool(BLOCK_RE.search((codex_dir / "config.toml").read_text(encoding="utf-8")))
    except OSError:
        return False
