#!/usr/bin/env python3
"""Standing spines (references/standing-spines.md): ongoing work that never closes. Declared by `Spine kind: standing`; pure helpers for validate_spine.py and spines.py."""
from __future__ import annotations

import re
from pathlib import Path

import personas

COLUMNS = ("Target", "Per", "Measure")
CLOSED = ("done", "closed", "superseded")


def is_standing(fields: dict[str, str]) -> bool:
    return fields.get("Spine kind", "").strip("`*_ ").lower() == "standing"


def targets(section: str, table) -> tuple[list[str], list[dict[str, str]]]:
    """(columns missing, rows keyed by canonical column) of ``## Targets``; ``table`` = validate_spine.parse_table."""
    header, cells = table(section)
    names = personas.base(header)
    return [c for c in COLUMNS if c not in names], [{c: dict(zip(header, r)).get(h, "") for c, h in names.items()} for r in cells]


def errors(sections: dict[str, str], status: str, table) -> list[str]:
    """A standing spine needs `## Targets` (Target | Per | Measure, one row at least, no empty cell), a Current State `Scoreboard:`, and never `Status: done`."""
    out = []
    if (word := re.match(r"[a-z]+", status.lower().lstrip("`*_ "))) and word.group() in CLOSED:
        out.append(f"standing spine cannot be {word.group()}: it never closes; set Status active (or deferred), and record a miss as an Issue Ledger row")
    if "Targets" not in sections:
        return out + ["standing spine missing section: ## Targets (| Target | Per | Measure |)"]
    missing, rows = targets(sections["Targets"], table)
    out += [f"Targets table missing column: {c}" for c in missing]
    out += ["Targets has no rows: one target per period"] * (not rows and not missing)
    out += [f"Targets row {n} has empty {c}" for n, r in enumerate(rows, 1) for c in COLUMNS if c in r and not r[c].strip()]
    state = re.search(r"(?m)^Scoreboard:[ \t]*(\S.*)$", sections.get("Current State", ""))
    if not state or state.group(1).strip().startswith("<"):
        out.append("standing spine Current State missing `Scoreboard:` (target vs actual this period)")
    return out


def info(fields: dict[str, str], sections: dict[str, str], table) -> dict | None:
    """``spines.py --json`` node: targets and scoreboard of a standing spine; None otherwise."""
    if not is_standing(fields):
        return None
    m = re.search(r"(?m)^Scoreboard:[ \t]*(.*)$", sections.get("Current State", ""))
    return {"targets": [{c.lower(): r.get(c, "") for c in COLUMNS} for r in targets(sections.get("Targets", ""), table)[1]], "scoreboard": (m.group(1).strip() or None) if m else None}
