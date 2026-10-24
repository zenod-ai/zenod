#!/usr/bin/env python3
"""The sweep on close, run as ``spine_fix.py --close [--write] SPINE...`` (references/tree-cleanse.md; vocabulary in spine_fix.py).

A finished epic (Status done/superseded, or ``Superseded by:``) keeps no open work: each open Issue Ledger row becomes ``superseded``
and its Next Action gets ``closed with epic <date>; successor: <Superseded by link or none>`` (date: the Outcome's Closed date, else
today; no Next Action column: the epic's ``Next action:`` line gets it once). Dry run unless ``--write``; idempotent."""

from __future__ import annotations

import datetime
import re
import sys
from collections import Counter
from pathlib import Path

import validate_spine as v
from spine_fix import epic_closed, row_open


def column(header: list[str], name: str) -> int:
    return next((n for n, c in enumerate(header) if c.strip().lower() == name.lower()), -1)


def ledger_rows(lines: list[str]):
    """(line index, header cells, row cells) per Issue Ledger data row; cells split on unescaped pipes, edges included."""
    section, header = "", []
    for i, line in enumerate(lines):
        if heading := re.match(r"## (.+?)[ \t]*$", line):
            section, header = v.normalize(heading.group(1)), []
        elif not line.strip().startswith("|"):
            header = []  # a table ends at the first non-table line
        elif section == "Issue Ledger":
            cells = re.split(r"(?<!\\)\|", line)
            if not header:
                header = [c.strip() for c in cells]
            elif not set(line.strip()) <= set("|-: "):
                yield i, header, cells


def open_rows(text: str) -> int:
    """Open ledger rows (spine_fix.row_open) in a finished epic; 0 when the epic is not finished."""
    return sum(row_open(c[s]) for _, h, c in ledger_rows(text.split("\n")) if 0 < (s := column(h, "Status")) < len(c) - 1) if epic_closed(text) else 0


def close_rows(text: str, today: str) -> tuple[str, list[str]]:
    """(text, what changed): a finished epic's open ledger rows become ``superseded`` with a Next Action note."""
    if v.doc_kind(text) != "spine" or not epic_closed(text):
        return text, []
    sup = v.parse_fields(text).get("Superseded by", "").strip()
    date = re.search(r"\d{4}-\d{2}-\d{2}", (v.outcome(text) or {}).get("closed_at") or "")
    note = f"closed with epic {date.group() if date else today}; successor: {'none' if v.is_empty(sup) or v.is_none(sup) else sup}".replace("|", "\\|")
    lines, old, unnoted = text.split("\n"), Counter(), False
    for i, header, cells in ledger_rows(lines):
        status, act = column(header, "Status"), column(header, "Next Action")
        if not 0 < status < len(cells) - 1 or not row_open(cells[status]):
            continue
        old[cells[status].strip()] += 1
        cells[status] = " superseded "
        if 0 < act < len(cells) - 1 and len(cells) == len(header):  # a row short of cells gets the note on the epic instead
            was = cells[act].strip()
            cells[act] = f" {was + ' · ' if was not in ('', '-') else ''}{note} "
        else:
            unnoted = True
        lines[i] = "|".join(cells)
    if not old:
        return text, []
    state = v.parse_sections(text).get("Current State", "")
    at = next((i for i, l in enumerate(lines) if re.match(r"(?i)Next action:", l) and l in state), None)
    if unnoted and at is not None:
        lines[at] += f" · ledger: {note}"
    return "\n".join(lines), [f"{sum(old.values())} open rows -> superseded (" + ", ".join(f"{w} {n}" for w, n in old.most_common()) + f"); {note}"]


def main(args: list[str]) -> int:
    write, today = "--write" in args, datetime.date.today().isoformat()
    for path in (Path(a) for a in args if a != "--write"):
        new, done = close_rows(path.read_text(encoding="utf-8", errors="replace"), today)
        if done and write:
            path.write_text(new, encoding="utf-8")
        print(f"{path}: " + (("closed: " if write else "would close: ") + "; ".join(done) if done else "nothing to close"))
    if not write:
        print("dry run: add --write to apply")
    return 0
