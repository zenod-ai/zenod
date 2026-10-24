#!/usr/bin/env python3
"""Scaffold an epic in the epic log: ``spine_new.py --repo DIR --parent SPINE --path NEW.md --title NAME [--purpose P] [--code N]``.

Writes a compact epic titled ``# EPIC-<n>: NAME`` (n = highest code in the repo's goal titles + 1, legacy ``E4``/``EPIC 0`` included, or
``--code``; criterion IDs ``E<n>-``) that follows references/spine-model.md: Goal, Serves (linked to the parent), Done means (checkbox
placeholders above the steps), Current State ``Status: draft`` (planning: never auto-queued; only the user stamps it ``ready``), Non-Goals, the steps ledger, Decisions, Operating Learnings; Root spine,
Parent spine, Integration branch/policy copied from the parent or AGENTS.md; no ``Spine Type:`` or version line. It registers a row in the
parent's Spine Map (created when missing) whose Purpose is the child's one "contributes" sentence (``--purpose``, else a placeholder).
``--parent`` is the parent's path or Spine ID. Idempotent: an existing file is never overwritten, only (re)registered when it is a spine.
Output passes ``validate_spine.py --trackable`` and the commit check's required sections. See references/spine-creation.md."""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spines as S  # noqa: E402
import validate_spine as v  # noqa: E402
from epic_log import next_of  # noqa: E402
from rollup_spine import cell  # noqa: E402

TEMPLATE = """# EPIC-{code}: {title}

Spine profile: compact
Repository: {repo}
Primary document: {primary}
Spine ID: {sid}
Root spine: [{root_title}]({root_link})
Parent spine: [{parent_title}]({parent_link})
Additional root rationale: n/a
Integration branch: {branch}
{policy}
## Goal

{purpose}

## Serves

[{parent_title}]({parent_link}): <one sentence: how this serves its parent>

## Done means

- [ ] {prefix}-1 <observable outcome and how it is measured>
- [ ] {prefix}-2 <a second outcome (2-5 in all), or delete this line>

## Current State

Owner: unassigned
Status: draft
Last attempted: scaffolded with spine_new.py on {today}
Result: created, not started
Evidence: {parent_link}
Waiting on: none
Approved work: none
Next action: fill Goal, Serves and Done means
Source revision: uncommitted scaffold
Verified at: {today}

## Non-Goals

TBD

## Issue Ledger

Steps: each is independently testable and closes only with evidence.

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| draft | Ticket worker | unassigned | first step | draft | none | none | none | none | {today} | write the first step |

## Decisions

One line per decision; detail goes to a linked page.

| Date | Outcome | Decision / Attempt | Durable Summary | Evidence | Revisit When |
|---|---|---|---|---|---|
| {today} | accepted | Created as a goal under {parent_id} | one node in the epic log | {parent_link} | never |

## Operating Learnings

None yet: one line each, `L-<n> | applies when | rule | why | confirmed <date>` (references/learnings.md).
"""


def die(message: str) -> int:
    print(f"spine_new: {message}", file=sys.stderr)
    return 1


def register(parent: Path, row: dict[str, str]) -> None:
    """Add ``row`` to the parent's Spine Map, creating the section when missing."""
    lines = parent.read_text(encoding="utf-8").split("\n")
    start = next((i for i, line in enumerate(lines) if re.fullmatch(r"## Spine Map[ \t]*", line)), None)
    if start is None:
        lines += ["", "## Spine Map", ""]
        start = len(lines) - 2
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    table = [i for i in range(start + 1, end) if lines[i].lstrip().startswith("|")]
    header = v.parse_table("\n".join(lines[table[0]:table[-1] + 1]))[0] if table else list(v.REQUIRED_SPINE_MAP_COLUMNS)
    new = "| " + " | ".join(cell(row.get(h, "none")) for h in header) + " |"
    if table:
        lines.insert(table[-1] + 1, new)
    else:
        lines[start + 1:end] = ["", "| " + " | ".join(header) + " |", "|" + "---|" * len(header), new, ""]
    parent.write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".")
    parser.add_argument("--parent", required=True, help="parent spine path or Spine ID")
    parser.add_argument("--path", required=True, help="new goal file")
    parser.add_argument("--title", required=True)
    parser.add_argument("--purpose")
    parser.add_argument("--spine-id")
    parser.add_argument("--code", type=int, help="EPIC number (default: highest in the repo + 1)")
    a = parser.parse_args()
    repo, cache = Path(a.repo).resolve(), {}
    parent = next((p.resolve() for p in (repo / a.parent, Path(a.parent)) if p.is_file()), None)
    parent = parent or next((p.resolve() for p in S.goal_docs(repo) if S.meta(p, cache)["id"] == a.parent), None)
    root = S.find_root(repo, cache)
    if parent is None:
        return die(f"parent {a.parent!r} is neither a spine file nor a Spine ID in {repo}")
    if root is None:
        return die("the repo has no root spine (Root spine: none); create or declare one first")
    pm = S.meta(parent, cache)
    if not pm["id"]:
        return die(f"parent {parent.name} has no Spine ID header; give it a v1 header first (references/spine-creation.md)")
    child = (repo / a.path).resolve()
    if not child.is_relative_to(repo):
        return die("--path is outside the repo")
    sid = a.spine_id or re.sub(r"[^a-z0-9]+", "-", a.title.lower()).strip("-")
    link = lambda target, source: Path(os.path.relpath(target, source.parent)).as_posix()  # noqa: E731
    title_of = lambda m: (re.search(r"(?m)^# (?:EPIC: )?(.+)", m["text"]) or [None, m["path"].stem])[1]  # noqa: E731
    existing = S.meta(child, cache)
    if existing is not None:
        if not existing["id"]:
            return die(f"{a.path} exists and is not a spine; refusing to overwrite (add the v1 header by hand)")
        sid, created = existing["id"], False
    else:
        child.parent.mkdir(parents=True, exist_ok=True)
        today, root_meta = date.today().isoformat(), S.meta(root, cache)
        log = S.scan(repo)
        code = a.code if a.code is not None else next_of(log)
        found = re.search(r"(?m)^Integration policy:.*", pm["text"]) or re.search(r"(?m)^Integration policy:.*", S.read(repo / "AGENTS.md"))
        child.write_text(TEMPLATE.format(
            title=a.title, code=code, policy=found.group() + "\n" if found else "", repo=pm["fields"].get("Repository", repo.name), primary=child.relative_to(repo).as_posix(), sid=sid, today=today,
            root_title=title_of(root_meta), root_link=link(root, child), parent_title=title_of(pm), parent_link=link(parent, child), parent_id=pm["id"],
            branch=pm["fields"].get("Integration branch", "main"), purpose=a.purpose or a.title, prefix=f"E{code}"), encoding="utf-8")
        created = True
    name = (re.search(r"(?m)^# (.+)", S.read(child)) or [0, a.title])[1]
    row = {"Spine ID": sid, "Relationship": "child", "Spine": f"[{name}]({link(child, parent)})", "Purpose": a.purpose or "<one sentence: what this adds to the parent's goal>", "Status": "draft",
           "Last Rolled Up": date.today().isoformat(), "Next Action": "fill Goal, Serves and Done means"}
    registered = child not in {t for _, t in pm["rows"]}
    if registered:
        register(parent, row)
    print(f"{'created' if created else 'exists'} {child}; {'registered in' if registered else 'already in'} {parent}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
