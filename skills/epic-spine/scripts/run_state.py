#!/usr/bin/env python3
"""Which epics a wake may run (EPIC-7, references/spine-model.md "Running"): the epic's own Status maps to a run_state and a runnable flag.

draft: planning; ready: ready; active, blocked: running; deferred: parked; review, done, superseded: finished (any other Status, or none: planning).
Runnable = ready or running. ``has_children``: a child spine that is not finished. Advisory warnings for validate_spine.py, never a block."""
from __future__ import annotations

import re

RUN = {"draft": "planning", "ready": "ready", "active": "running", "blocked": "running", "deferred": "parked", "review": "finished", "done": "finished", "superseded": "finished"}


def run_state(status: str) -> str:
    return RUN.get(status, "planning")


def fields(status: str, kids: list[str]) -> dict:
    """The node fields: ``run_state``, ``runnable`` (own Status), ``has_children`` (``kids``: the children's own Statuses)."""
    return {"run_state": run_state(status), "runnable": run_state(status) in ("ready", "running"), "has_children": any(run_state(k) != "finished" for k in kids)}


def issues(text: str, sections: dict, state: dict, header: list[str], rows: list[list[str]]) -> list[str]:
    """Advisories: an epic ``active`` with no start recorded, or ``draft`` with ledger rows already ``active``."""
    import doctrine
    if "Current State" not in sections or not doctrine.is_epic(text):
        return []
    out, status = [], (m.group() if (m := re.match(r"[a-z]+", state.get("status", "").lower())) else "")
    attempted = state.get("last_attempted", "").lower()
    if status == "active" and (not attempted.strip("`*_ ") or attempted.startswith("scaffolded")):
        out.append("run-state: Status is active but Last attempted records no persona or worker start: record who was started, or set Status ready")
    if status == "draft" and "Status" in header and any(r[header.index("Status")].lower() == "active" for r in rows if len(r) > header.index("Status")):
        out.append("run-state: Status is draft (planning, not runnable) but ledger rows are active: set the epic Status to active, or the rows back to draft/ready")
    return out
