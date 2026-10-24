#!/usr/bin/env python3
"""``git fetch origin`` that cannot snowball (used by repo_sync.sync and auto_return.run). Stdlib only; never raises.

A fetch killed mid-download restarts from zero next run and leaves an orphan ``objects/pack/tmp_pack_*`` each time
(VH-T20: 138 files, 17 GB, a full disk). So a timeout kills git's whole process group, removes only the tmp files this
run created, and counts a strike in ``<git-dir>/epicspine-backoff.json``."""

from __future__ import annotations

import contextlib
import json
import time
from pathlib import Path

from session_sync import Clock, git, out

STRIKES, BACKOFF_BASE, BACKOFF_MAX = 2, 1800.0, 6 * 3600.0  # timeouts before backing off; first skip; longest skip (s)


def _state_file(top: Path, clock: Clock) -> Path | None:
    path = out(git(["rev-parse", "--git-path", "epicspine-backoff.json"], top, clock, 3))
    return top / path if path else None


def _tmp_packs(top: Path, clock: Clock) -> dict[Path, float]:
    pack = out(git(["rev-parse", "--git-path", "objects/pack"], top, clock, 3))
    found: dict[Path, float] = {}
    for pattern in ("tmp_pack_*", "tmp_idx_*"):
        for path in (top / pack).glob(pattern) if pack else ():
            with contextlib.suppress(OSError):
                found[path] = path.stat().st_mtime
    return found


def fetch(top: Path, clock: Clock, seconds: float, *flags: str) -> tuple[bool, list[str]]:
    """``git fetch origin`` that cannot snowball. A timeout kills git's process group, deletes only the
    tmp_pack_*/tmp_idx_* files this run created (a killed fetch restarts from zero and would leave one per run),
    and counts a strike; STRIKES in a row skip fetching for a growing while (BACKOFF_BASE doubling, max
    BACKOFF_MAX) with an attention line asking for a manual fetch. A successful fetch resets it."""
    clock, shared = Clock(3), clock  # bookkeeping needs git after the shared clock is spent; the fetch itself uses `shared`
    state, now = _state_file(top, clock), time.time()
    data: dict = {}
    with contextlib.suppress(OSError, ValueError):
        data = json.loads(state.read_text(encoding="utf-8")) if state else {}
    if not isinstance(data, dict):
        data = {}
    if now < float(data.get("skip_until") or 0):
        return False, [f"EpicSpine attention: repo {top.name} needs the user: background fetch timed out {data.get('timeouts')} "
                       f"times in a row (large pending download), so it is skipped until {time.strftime('%H:%M', time.localtime(data['skip_until']))}; "
                       f"run `git -C {top} fetch origin` by hand. Tell the user exactly this; do not fetch it yourself."]
    if not shared.ok():
        return False, []
    before, info = _tmp_packs(top, clock), {}
    got = git(["fetch", "--quiet", *flags, "origin"], top, shared, seconds, info)
    if got is not None and got.returncode == 0:
        if data and state:
            with contextlib.suppress(OSError):
                state.unlink()
        return True, []
    if not info.get("timeout"):
        return False, []
    for path, mtime in _tmp_packs(top, clock).items():
        if path not in before and mtime >= now - 1:
            with contextlib.suppress(OSError):
                path.unlink()
    strikes = int(data.get("timeouts") or 0) + 1
    data = {"timeouts": strikes}
    if strikes >= STRIKES and state:
        data["skip_until"] = now + min(BACKOFF_MAX, BACKOFF_BASE * 2 ** (strikes - STRIKES))
    if state:
        with contextlib.suppress(OSError):
            state.write_text(json.dumps(data), encoding="utf-8")
    return False, []
