#!/usr/bin/env python3
"""``validate_spine.py --fix``: rewrite spines/tickets in place to the trackable contract (idempotent).

Fixes criteria (numbered/bullet/unchecked/ID-less items under Definition Of Done or ticket Acceptance become
``- [ ] <ID> <text>``; existing IDs kept, new ones continue the file's most common ID prefix, else DOD/AC),
spine alias headings (``## Exit Test...``, ``## Acceptance`` -> ``## Definition Of Done``), unambiguous Status
synonyms (SYNONYMS) and a lone preamble ``Status:`` line with none in Current State (moved there, not copied).
It never invents a Status line/column or criteria, and leaves unknown statuses alone.

``spine_fix.py --close [--write] SPINE...``: the sweep on close (references/tree-cleanse.md). In an epic whose Status is done/superseded
(or with ``Superseded by:``), every open ledger row (draft/ready/active/blocked/review, or a non-standard word that is not done-like)
becomes ``superseded`` and its Next Action gets ``closed with epic <date>; successor: <link or none>``. Dry run unless ``--write``;
done/deferred/superseded rows are never touched; idempotent. The row vocabulary lives here (the one place row words are mapped);
the sweep body is in close_rows.py (this file's 200-line cap)."""

from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

import validate_spine as v

# canonical status -> synonyms (case-insensitive; space and hyphen interchangeable); the one place the map lives.
# Only a leading word that unambiguously means one status is mapped; "current", "generic", "prior", "guest" and the
# like stay unmapped, so --trackable blocks on them instead of guessing.
SYNONYMS = {
    "active": "in progress|wip|doing|in review|review|testing",
    "ready": "todo|to do|planned|open|backlog",
    "done": "closed|complete|completed|delivered|shipped|merged|integrated|resolved",
    "superseded": "dropped|obsolete|wontfix|wont fix|cancelled|canceled|abandoned",  # closed, not done
    "deferred": "on hold|paused|parked",
    "draft": "proposed",
}
ROW_CLOSED = ("done", "deferred", "superseded")  # a ledger row in any other state is open work
DONE_LIKE = ("live", "deployed", "verified", "accepted", "fixed")  # non-standard row words the close sweep treats as done
SYNONYM = re.compile(r"(?i)[*_`\s]*(?:" + "|".join(f"(?P<{k}>{p.replace(' ', '[ -]?')})" for k, p in SYNONYMS.items()) + r")(?![A-Za-z])")
HEADER_STATUS = re.compile(r"(?:\*\*Status:\*\*|\*\*Status\*\*:|Status:)[ \t]*(\S.*)$")
ITEM = re.compile(r"(?:[-*]|\d+[.)])[ \t]+(?:\[([ xX])\][ \t]+)?(.*)$")
ID_AT = re.compile(rf"[*_`(\[]*({v.ID})[*_`)\]]*[:.]?(?=\s|$)\s*")


def synonym(value: str, whole: bool = False) -> tuple[str, str, str] | None:
    """(canonical status, value with the leading synonym replaced, the synonym); ``whole``: only if nothing else follows."""
    match = SYNONYM.match(value)
    if not match or (whole and value[match.end():].strip(" *_`")):
        return None
    status = next(k for k in SYNONYMS if match.group(k))
    return status, value[: match.start(status)] + status + value[match.end():], match.group(status)


def row_word(cell: str) -> str:
    """The canonical (or else leading) status word of a Status cell/line: ``blocked / package merged`` -> blocked."""
    cell = cell.strip(" \t*_`").lower()
    if found := synonym(cell):
        return found[0]
    return m.group() if (m := re.match(r"[a-z]+", cell)) else ""


def row_open(cell: str) -> bool:
    return (word := row_word(cell)) != "" and word not in ROW_CLOSED + DONE_LIKE


def epic_closed(text: str) -> bool:
    """Status done/superseded (or a synonym), or a ``Superseded by:`` header that is not none."""
    status = v.parse_key_values(v.parse_sections(text).get("Current State", "")).get("Status", "")
    sup = v.parse_fields(text).get("Superseded by", "")
    return row_word(status) in ("done", "superseded") or not (v.is_empty(sup) or v.is_none(sup))


def heading_at(lines: list[str], name: str) -> int:
    return next(i for i, line in enumerate(lines) if line.startswith("## ") and v.normalize(line[3:]) == name)


def fix_criteria(lines: list[str], spine: bool) -> list[str]:
    done, sections = [], v.parse_sections("\n".join(lines))
    names = ("Definition Of Done", "Done means") if spine else ("Acceptance Criteria", "Acceptance")
    alias = next((n for n in sections if v.DOD_ALIAS_RE.fullmatch(n)), None)
    if spine and "Definition Of Done" not in sections and alias:
        lines[heading_at(lines, alias)] = "## Definition Of Done"
        done.append(f"heading '{alias}' -> Definition Of Done")
    items = v.criteria("\n".join(lines), names)
    parsed = {i: ITEM.match(line) for i, line in items if not v.CRITERION_RE.match(line)}
    rests = {i: re.sub(r"^\d+[.)]\s+", "", m.group(2)) if m.group(1) else m.group(2) for i, m in parsed.items()}
    ids = [m.group(1) for _, line in items if (m := v.CRITERION_RE.match(line))]
    ids += [m.group(1) for rest in rests.values() if (m := ID_AT.match(rest))]
    prefix = Counter(x.rsplit("-", 1)[0] for x in ids).most_common(1)[0][0] if ids else "DOD" if spine else "AC"
    top = max((int(x.rsplit("-", 1)[1]) for x in ids if x.rsplit("-", 1)[0] == prefix), default=0)
    for i, m in parsed.items():
        if found := ID_AT.match(rests[i]):
            tag, rest = found.group(1), rests[i][found.end():]
        else:
            top, rest = top + 1, rests[i]
            tag = f"{prefix}-{top}"
        lines[i] = f"- [{m.group(1) or ' '}] {tag} {rest}".rstrip()
    return done + ([f"{len(parsed)} criteria -> '- [ ] ID text'"] if parsed else [])


def fix_statuses(lines: list[str], spine: bool) -> list[str]:
    """Map Status synonyms in the Current State / ticket ``Status:`` line and Issue Ledger Status cells."""
    done, section, column = [], "", -1
    for i, line in enumerate(lines):
        if heading := re.match(r"## (.+?)[ \t]*$", line):
            section, column = v.normalize(heading.group(1)), -1
        elif (section == "Current State" if spine else not section) and (m := re.match(r"(Status:[ \t]*)(.*)$", line)):
            if found := synonym(m.group(2)):
                lines[i] = m.group(1) + found[1]
                done.append(f"Status '{found[2]}' -> {found[0]}")
        elif spine and section == "Issue Ledger" and line.strip().startswith("|"):
            cells = re.split(r"(?<!\\)\|", line)
            if column < 0:
                column = next((n for n, c in enumerate(cells) if c.strip() == "Status"), -1)
            elif column < len(cells) and (found := synonym(cells[column].strip(), whole=True)):
                cells[column] = f" {found[1]} "
                lines[i] = "|".join(cells)
                done.append(f"ledger Status '{found[2]}' -> {found[0]}")
    return list(dict.fromkeys(done))


def move_header_status(lines: list[str]) -> list[str]:
    """Move the single preamble ``Status:`` line into Current State when that has none (fix_statuses then maps it)."""
    heads = [i for i, line in enumerate(lines) if line.startswith("## ")]
    found = [(i, m) for i, line in enumerate(lines[: heads[0] if heads else len(lines)]) if (m := HEADER_STATUS.match(line))]
    state = next((i for i in heads if v.normalize(lines[i][3:]) == "Current State"), None)
    if len(found) != 1 or state is None:
        return []
    end = next((i for i in heads if i > state), len(lines))
    if any(line.startswith("Status:") for line in lines[state + 1 : end]):
        return []
    index, match = found[0]
    del lines[index]
    if index and index < len(lines) and not lines[index - 1].strip() and not lines[index].strip():
        del lines[index]
    state = next(i for i, line in enumerate(lines) if line.startswith("## ") and v.normalize(line[3:]) == "Current State")
    at = state + 1
    while at < len(lines) and not lines[at].strip():
        at += 1
    follows = at < len(lines) and re.match(r"[A-Za-z][A-Za-z ]+:", lines[at])
    lines[at:at] = [""] * (at == state + 1) + [f"Status: {match.group(1)}"] + [""] * (not follows)
    return ["Status moved from header to Current State"]


def fix_text(text: str) -> tuple[str, list[str]]:
    """(fixed text, what changed); a non-spine/ticket is returned unchanged."""
    kind, lines = v.doc_kind(text), text.split("\n")
    if kind is None:
        return text, []
    done = fix_criteria(lines, kind == "spine") + (move_header_status(lines) if kind == "spine" else []) + fix_statuses(lines, kind == "spine")
    return "\n".join(lines), done


def main(paths: list[Path]) -> int:
    for path in paths:
        try:
            raw = path.read_bytes().decode("utf-8")
        except (OSError, UnicodeDecodeError) as error:
            print(f"{path}: skipped ({error})")
            continue
        new, done = fix_text(raw)
        if new != raw:
            path.write_bytes(new.encode("utf-8"))
        print(f"{path}: " + ("fixed: " + "; ".join(done) if done else "nothing to fix"))
    return 0


if __name__ == "__main__":
    sys.exit(__import__("close_rows").main(sys.argv[2:]) if sys.argv[1:2] == ["--close"] else main([Path(a) for a in sys.argv[1:]]))
