#!/usr/bin/env python3
"""Status-true advisories for validate_spine.py (EPIC-6): the spine shapes that make the console status lie. Warnings that --strict promotes.

1. Jordi named with no coded ask: a `## Waiting on` line or Current State `Waiting on:`, or an open ledger row he owns.
2. `Status: done` (spine, or a ledger row citing a criterion ID) while a Done-means box is unticked.
3. `Waiting on:` says nothing is open for him while a coded ask is open in the same spine.
Also `closed-rows:` (advisory, never strict-promoted): a finished epic with open ledger rows (sweep: `spine_fix.py --close`)."""
from __future__ import annotations

import re
from pathlib import Path

import personas

NAME = re.compile(rf"(?i)(?<![\w-]){personas.HUMAN}\b")
UNTICKED = re.compile(r"(?m)^\s*- \[ \]\s*([A-Z][A-Z0-9]*-\d+)?")
ASK = "`[ask <CODE>: decide|approve|provide|do @Jordi since <date> row <id>]`"


def issues(text: str, sections: dict[str, str], status: str, header: list[str], rows: list[list[str]]) -> list[str]:
    import validate_spine as v  # lazy: ask_refs and epic_log import validate_spine
    from ask_refs import MENTION, NO_HUMAN, TAG, WAIT, ANSWERED_TAG, OPEN_TAG, SUPERSEDED_TAG, asks
    from epic_log import row_keys
    out, said = [], v.parse_key_values(sections.get("Current State", "")).get("Waiting on", "")
    open_asks = [a for a in asks(text, Path("-"), Path("-")) if a["state"] == "open"]
    for raw in sections.get("Waiting on", "").splitlines():
        line = raw.strip()
        tag = m.group(1) if (m := TAG.fullmatch(line)) else ""
        coded = WAIT.fullmatch(line) or any((r := p.fullmatch(tag)) and r.group(1) for p in (OPEN_TAG, ANSWERED_TAG, SUPERSEDED_TAG))
        if line.startswith(("-", "*")) and NAME.search(line) and not coded and not NO_HUMAN.match(line[1:].strip()):
            out.append(f"status-true: ## Waiting on line '{line[:50]}' names Jordi with no coded ask: write {ASK}")
    if NAME.search(said) and not MENTION.search(said) and not NO_HUMAN.match(said):
        out.append(f"status-true: Current State `Waiting on: {said[:40]}` names Jordi with no ask code: cite the coded ask, or write `nobody`")
    for number, row in enumerate(rows, 1):
        r = dict(zip(header, row))
        owner = next((c for k, c in r.items() if k.lower().startswith("owner")), "")
        if r.get("Status", "").lower() in personas.OPEN and NAME.search(owner) and not any(
                NAME.search(a["who"]) and a["code"] and (not a["row"] or a["row"].lower().strip("#[] ").rstrip(".:)") in row_keys(r)) for a in open_asks):
            out.append(f"status-true: ledger row {number} is open and owned by Jordi with no coded ask naming it: write {ASK}")
    dod = sections.get("Definition Of Done", "")
    boxes = {m.group(1) for m in UNTICKED.finditer(dod) if m.group(1)}
    if status.lstrip("`*_ ").startswith("done") and UNTICKED.search(dod):
        out.append("status-true: Status is done but a Definition Of Done box is unticked: tick it with evidence, or reopen the status")
    for number, row in enumerate(rows, 1):
        r = dict(zip(header, row))
        cited = sorted(i for i in boxes if re.search(rf"(?<![\w-]){i}(?![\w-])", f"{r.get('Title', '')} {r.get('Latest Evidence', '')}"))
        if r.get("Status", "").lower() == "done" and cited:
            out.append(f"status-true: ledger row {number} is done but cites unticked Done means {', '.join(cited)}")
    from close_rows import open_rows
    if n := open_rows(text):
        out.append(f"closed-rows: finished epic with {n} open rows: run `spine_fix.py --close --write <this spine>` (they become superseded)")
    if NO_HUMAN.match(said) and any(a["code"] for a in open_asks):
        out.append("status-true: `Waiting on:` says nothing is open but ask " + ", ".join(a["code"] for a in open_asks if a["code"]) + " is open: list it, or answer it")
    return out
