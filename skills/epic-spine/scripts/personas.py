#!/usr/bin/env python3
"""Persona files (``personas/<name>.md``) and epic Team tables (references/personas.md): format rules and the assignee check.

Pure helpers over text and parsed table rows (validate_spine.py and spines.py call them); ``personas.py FILE...`` prints each file's errors, exit 1 on any."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

FRONT = ("name", "template", "model", "host")
BODY = ("Remit", "Reads", "Writes")
FORBIDDEN = {"goal", "cadence", "write scope"}  # assignment, not identity: lives in the epic's Team table
TEAM_COLUMNS = ("Persona", "Cadence", "Write scope")
HUMAN = "jordi"
OPEN = {"ready", "active", "blocked", "review", "testing"}


def slug(value: str) -> str:
    """``[Delivery Manager](x.md) (acts as Fixer)`` -> ``delivery-manager``: how files, Team cells and assignees are compared."""
    value = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", value)
    return re.sub(r"[^a-z0-9]+", "-", re.sub(r"\(.*", "", value).lower()).strip("-")


def base(header: list[str]) -> dict[str, str]:
    """Table header -> its name without a trailing ``(…)``: ``Cadence (console)`` counts as ``Cadence``."""
    return {re.sub(r"\s*\(.*\)\s*$", "", h).strip(): h for h in header}


def is_file(path: Path, text: str) -> bool:
    return path.parent.name == "personas" and text.startswith("---")


def frontmatter(text: str) -> tuple[dict[str, str], str]:
    head, _, body = text[3:].partition("\n---") if text.startswith("---") else ("", "", text)
    pairs = (line.split(":", 1) for line in head.splitlines() if ":" in line)
    return {k.strip().lower().replace("_", " ").replace("-", " "): v.strip().strip("\"'") for k, v in pairs}, body


def file_errors(path: Path, text: str) -> list[str]:
    front, body = frontmatter(text)
    headings = {m.group(1).strip() for m in re.finditer(r"(?m)^## (.+)$", body)}
    out = [f"persona file missing frontmatter key: {k}" for k in FRONT if not front.get(k)]
    out += [f"persona file has a {k} field: that belongs to the assignment (the epic's Team table), not the persona" for k in sorted(FORBIDDEN & front.keys())]
    out += [f"persona file missing section: ## {s}" for s in BODY if s not in headings]
    out += [f"persona file has a ## {h} section: that belongs to the assignment (the epic's Team table)" for h in sorted(headings) if h.lower() in FORBIDDEN]
    if front.get("name") and slug(front["name"]) != slug(path.stem):
        out.append(f"persona name {front['name']!r} does not match the file name {path.name}")
    return out


def names(repo: Path) -> dict[str, Path]:
    """Persona files of a repo: slug -> path (``personas/*.md`` at the repo root, README.md aside)."""
    return {slug(p.stem): p for p in sorted((repo / "personas").glob("*.md")) if p.name.lower() != "readme.md"}


def repo_root(path: Path) -> Path:
    here = path.resolve().parent
    return next((p for p in (here, *here.parents) if (p / ".git").exists()), here)


def team(rows: list[dict[str, str]], header: list[str], files: dict | None = None) -> tuple[list[str], list[str]]:
    """(persona slugs, errors) of an epic's ``## Team`` table; with persona files in the repo each persona must have one."""
    names = base(header)
    out = [f"Team table missing column: {c}" for c in TEAM_COLUMNS if c not in names]
    people: list[str] = []
    for n, row in enumerate(rows, 1):
        row = {c: row.get(h, "") for c, h in names.items()}
        who = slug(row.get("Persona", ""))
        if not who:
            out.append(f"Team row {n} has no persona")
            continue
        out += [f"Team row {n} ({who}) has empty {c}" for c in TEAM_COLUMNS[1:] if c in names and not row.get(c, "").strip()]
        out += [f"Team lists {who} twice"] * (who in people)
        out += [f"Team persona {who} has no file personas/{who}.md"] * (bool(files) and who not in files)
        people.append(who)
    return people, out


def assignee_errors(rows: list[dict[str, str]], people: list[str], files: dict | None = None) -> list[str]:
    """Non-draft ledger rows whose assignee is neither a persona on the team (the persona files, else the Team table) nor Jordi."""
    known = set(files or people) | {HUMAN}
    return [f"ledger row {n} ({r.get('Issue', '')}) is {r['Status']} but assignee {r.get('Owner / Assignment', '')!r} is not a team persona or Jordi"
            for n, r in enumerate(rows, 1) if r.get("Status", "").lower() != "draft" and slug(r.get("Owner / Assignment", "")) not in known]


def epic_errors(path: Path, sections: dict[str, str], header: list[str], rows: list[dict[str, str]], table) -> list[str]:
    """Rules for an epic with a ``## Team`` section (the opt-in; legacy spines are untouched). ``table`` = validate_spine.parse_table."""
    head, cells = table(sections["Team"])
    files = names(repo_root(path))
    people, out = team([dict(zip(head, c)) for c in cells], head, files)
    return out + (assignee_errors(rows, people, files) if "Owner / Assignment" in header and "Status" in header else [])


def team_json(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    rows = [{c: r.get(h, "") for c, h in base(list(r)).items()} for r in rows]
    return [{"persona": slug(r.get("Persona", "")), "cadence": r.get("Cadence", ""), "write_scope": r.get("Write scope", ""), "notes": r.get("Notes", "")} for r in rows]


def roster(repo: Path, nodes: list[dict], ledgers: dict[str, list[dict[str, str]]]) -> list[dict]:
    """Personas (files, then Team rows; Jordi when he has rows), each with its ``epics`` and ``queue``: its open ledger rows across the tree (a draft or finished row is nobody's queue)."""
    out = {k: {"name": k, "path": os.path.relpath(f, repo), **frontmatter(f.read_text())[0], "epics": [], "queue": []} for k, f in names(repo).items()}
    for n in nodes:
        for t in n["team"]:
            out.setdefault(t["persona"], {"name": t["persona"], "path": None, "epics": [], "queue": []})["epics"].append(n["path"])
    for epic, rows in ledgers.items():
        for r in rows:
            who = slug(r.get("Owner / Assignment", ""))
            if r.get("Status", "").lower() in OPEN and (who in out or who == HUMAN):
                out.setdefault(who, {"name": "Jordi", "path": None, "epics": [], "queue": []})["queue"].append({"epic": epic, "issue": r.get("Issue", ""), "title": r.get("Title", ""), "status": r.get("Status", "")})
    return list(out.values())


if __name__ == "__main__":
    found = [(p, e) for p in sys.argv[1:] for e in file_errors(Path(p), Path(p).read_text())]
    print(*(f"{p}: {e}" for p, e in found), sep="\n")
    sys.exit(int(bool(found)))
