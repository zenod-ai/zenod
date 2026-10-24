#!/usr/bin/env python3
"""Pre-commit gate (installed by ``agents_block.py install``): staged spine/ticket Markdown must be
``validate_spine.py --trackable``. A fixable file with no unstaged changes is fixed (``--fix``) and re-staged; with
unstaged changes it blocks with the exact fix command; it also blocks when only a guess would fix it. ``--strict``
is advisory (printed, never blocks). A staged ``.md`` is a spine if it has ``## Current State`` or ``Spine ID:``,
a ticket if it has ``Ticket ID:``. A goal doc (``spines.is_goal``) must also be a consistent node of the epic log: a
v1 header, reachable from the root, agreeing with its parent's Spine Map (``spine_new.py``). Blocks only a newly added or
renamed goal doc, and a modified one whose HEAD version already had ``Spine ID:`` (migrated). Warns, never blocks: a
modified legacy goal doc (no ``Spine ID:`` at HEAD), a root spine without a ``Spine ID:`` header, ``Root spine: none`` and a goal
spine whose ``## Current State`` has over 12 non-empty lines, and ``epic_log.ask_issues`` (human-asks.md checks: blocked/waiting row or epic with no open ask, ask missing a field or code, duplicate code, over 3 open, stale) and ``grants.grant_issues`` (standing-approvals.md: unreadable grant line, reused code, grant cited after expiry or revoke). ``Superseded by:`` must link to an existing goal doc (blocks).
Doctrine 2 (doctrine.py, references/spine-model.md): a newly *added* epic (``A``, not renamed) missing the title, Goal (Mission counts), Serves (not the root), Done means or Status word
blocks; an existing epic only warns of the same gaps, of over 150 lines or a table cell over 200 characters; a staged page warns when it looks like an epic or no epic links it."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import doctrine  # noqa: E402
import spine_fix  # noqa: E402
import spines  # noqa: E402
import validate_spine as v  # noqa: E402
from grants import advisory  # noqa: E402


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], capture_output=True, text=True)


def say(message: str) -> None:
    print(f"epicspine: {message}", file=sys.stderr)


def tree_check(name: str, added: set[str], cache: dict, told: set[str]) -> tuple[bool, str]:
    """(blocks, message) for one staged goal doc; a root-level notice is given once."""
    cwd = Path.cwd()
    root = spines.find_root(cwd, cache)
    notice = "no root spine: goal docs are not checked against the epic log" if root is None else \
        "" if spines.meta(root, cache)["id"] else "root spine has no Spine ID header: migrate the root first (goal docs are not checked against the epic log yet)"
    if notice:
        first = notice not in told
        told.add(notice)
        return False, notice if first else ""
    tree = spines.problems(cwd, Path(name), cache)
    if not tree:
        return False, ""
    legacy = name not in added and not spines.ID_LINE.search(git("show", f"HEAD:{name}").stdout)
    why = f"{name}: not in the epic log: " + "; ".join(tree)
    if legacy:
        return False, f"{why} (legacy goal doc, not blocked; migrate with {HERE / 'spines.py'} / {HERE / 'spine_new.py'})"
    return True, why + f". Fix: python3 {HERE / 'spine_new.py'} --repo . --parent <parent spine> --path {name} --title <title> (new doc), or add the v1 header + a parent Spine Map row (existing doc)"


def goal_notes(name: str, text: str, cache: dict) -> tuple[bool, str]:
    """(blocks, message): a ``Superseded by:`` link that is no goal doc blocks; a long Current State only warns."""
    cwd = Path.cwd().resolve()
    sup = spines.meta(Path(name), cache)["fields"].get("Superseded by")
    target = spines.link(Path(name).resolve(), sup, cache) if sup else None
    if sup and not (target and target.is_file() and target.is_relative_to(cwd) and spines.is_goal(cwd, target.relative_to(cwd), spines.read(target))):
        return True, f"{name}: Superseded by {sup!r} is not an existing goal doc"
    lines = [x for x in v.parse_sections(text).get("Current State", "").splitlines() if x.strip()]
    return False, f"{name}: Current State has {len(lines)} lines; keep Current State lean: history goes to Decisions/git" if len(lines) > 12 else ""


def doctrine_notes(name: str, text: str, new: bool, cache: dict) -> tuple[bool, str]:
    """(blocks, message): a new epic missing a required section blocks; an existing one only warns (also of size)."""
    root = spines.find_root(Path.cwd(), cache)
    found = doctrine.fields(text, bool(root and Path(name).resolve() == root) or v.parse_fields(text).get("Root spine", "").lower() == "self")
    size, notes = found["size"], []
    if found["missing_sections"]:
        notes.append(f"epic is missing {', '.join(found['missing_sections'])} (references/spine-model.md: What Every Epic Says; spine_new.py writes them)")
    if size["lines"] > doctrine.MAX_LINES or size["long_cells"]:
        notes.append(f"over the size budget: {size['lines']} lines (max {doctrine.MAX_LINES}), {size['long_cells']} table cells over {doctrine.MAX_CELL} characters: move detail to linked pages")
    blocks = new and bool(found["missing_sections"])
    return blocks, f"{name}: " + "; ".join(notes) + ("" if blocks else " (advisory)") if notes else ""


def page_notes(names: list[str]) -> list[str]:
    """Advisory: staged pages that look like an epic (intent belongs in an epic) or that no epic links (orphans)."""
    cwd = Path.cwd().resolve()
    epics = {p for p in doctrine.docs(cwd) if doctrine.is_epic(doctrine.read(p))}
    orphans, like = doctrine.page_report(cwd, sorted(epics), epics)
    return [f"{n}: " + why + " (advisory)" for n in names for why, bad in (("looks like an epic: give it an EPIC-<n> title and a parent (spine_new.py)", like), ("orphan page: link it from an epic or another page", orphans)) if n in bad]


def main() -> int:
    top = git("rev-parse", "--show-toplevel").stdout.strip()
    if top:
        os.chdir(top)
    blocked, cache, told, pages = False, {}, set(), []
    added = set(filter(None, git("diff", "--cached", "--name-only", "--diff-filter=AR", "-z").stdout.split("\0")))
    created = set(filter(None, git("diff", "--cached", "--name-only", "--diff-filter=A", "-z").stdout.split("\0")))
    for name in filter(None, git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").stdout.split("\0")):
        path = Path(name)
        if not (name.endswith(".md") and path.is_file()):
            continue
        raw = path.read_bytes()
        text = raw.decode("utf-8", errors="replace")
        kind = v.doc_kind(text)
        if spines.is_goal(Path.cwd(), path, text):
            stop, note = tree_check(name, added, cache, told)
            blocked = blocked or stop
            if note:
                say(note)
            stop, note = goal_notes(name, text, cache)
            blocked = blocked or stop
            if note:
                say(note)
            stop, note = doctrine_notes(name, text, name in created, cache)
            blocked = blocked or stop
            if note:
                say(note)
        elif not spines.D.skipped(Path.cwd(), path) and path.stem.lower() not in doctrine.CONVENTIONAL:
            pages.append(name)
        if kind is None:
            continue
        result, hint = v.trackable(path), ""
        if not result["trackable"] and (change := spine_fix.fix_text(text)) and change[1] and text.encode() == raw:
            if git("diff", "--quiet", "--", name).returncode:
                hint = f"; unstaged changes, so not auto-fixed: run `python3 {HERE / 'validate_spine.py'} --fix {name}`, review, then `git add {name}`"
            else:
                path.write_bytes(change[0].encode("utf-8"))
                git("add", "--", name)
                say(f"fixed {name}: " + "; ".join(change[1]))
                result = v.trackable(path)
        if not result["trackable"]:
            blocked = True
            say(f"{name}: not trackable: " + "; ".join(result["missing"]) + hint)
        for note in advisory(text, path) if kind == "spine" else []:
            say(f"{name}: {note} (advisory)")
        if kind == "spine" and v.validate_local(path).fails(strict=True):
            say(f"{name}: --strict issues (advisory; run validate_spine.py --strict)")
    for note in page_notes(pages) if pages else []:
        say(note)
    if blocked:
        say("commit blocked; fix the above, or bypass once with git commit --no-verify")
    return int(blocked)


if __name__ == "__main__":
    sys.exit(main())
