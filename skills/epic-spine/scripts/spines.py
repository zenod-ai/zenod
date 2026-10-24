#!/usr/bin/env python3
"""The epic log: one tree of goals per repo, hung from the root spine (references/spine-model.md).

``spines.py --bind [EPIC]`` prints the bind view (title, Current State, Operating Learnings of EPIC and its ancestors). ``spines.py [--json | --active] --repo DIR`` finds the root (AGENTS.md ``Root spine:``, else a root-typed header), walks children
(a child's ``Parent spine:`` header decides; the parent's Spine Map must agree; links resolve against the file's folder, else
the repo root) and lists goal docs outside the tree as orphans. Goal doc (epic) = a ``# EPIC-<n>:`` title or a ``Spine ID:`` line, never
a name (doctrine.py; any other .md is a page, reported as ``pages`` / ``orphan_pages`` / ``looks_like_epic``); skipped: archive/,
node_modules, dot-dirs, handoffs/, examples/, fixtures/, test/, tests/, vendored skills. Exits 0."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import doctrine as D  # noqa: E402
import personas as P  # noqa: E402
import run_state as R  # noqa: E402
import standing as S  # noqa: E402
import validate_spine as v  # noqa: E402
from ask_refs import resolve, waits  # noqa: E402
from grants import grants, uses  # noqa: E402
from epic_log import active, asks, next_of, link_problems, render, rollup, stale  # noqa: E402

ID_LINE = D.ID_LINE
ROOT_LINE = re.compile(r"Root spine: \[?`?([^`\]\s)]+)")
STATE_LABELS = ("Owner", "Status", "Last attempted", "Result", "Evidence", "Waiting on", "Approved work", "Next action", "Verified at")


read = D.read


def current_state(sections: dict[str, str]) -> dict | None:
    """The ``## Current State`` labels as snake_case keys, raw text after ``Label:`` (None: missing or empty; no section: None)."""
    values = v.parse_key_values(sections.get("Current State", ""))
    return {label.lower().replace(" ", "_"): values.get(label) or None for label in STATE_LABELS} if "Current State" in sections else None


def is_goal(repo: Path, rel: Path, text: str) -> bool:
    return rel.suffix == ".md" and not D.skipped(repo, rel) and D.is_epic(text)


def goal_docs(repo: Path) -> list[Path]:
    return [p for p in D.docs(repo) if D.is_epic(read(p))]


def link(path: Path, value: str, cache: dict) -> Path | None:
    """A header/map link target: relative to the file's folder, else to the repo root (cache[None])."""
    target = v.resolve_local_link(path, value)
    alt = v.resolve_local_link(cache[None] / "-", value) if target and not target.exists() else None
    return alt if alt and alt.exists() else target


def meta(path: Path, cache: dict) -> dict | None:
    path = path.resolve()
    if path not in cache:
        text = read(path) if path.is_file() else None
        fields, sections = v.parse_fields(text or ""), v.parse_sections(text or "")
        rows = [(r.get("Spine ID", ""), link(path, r.get("Spine", ""), cache)) for r in v.table_rows(sections.get("Spine Map", ""))]
        cache[path] = None if text is None else {"path": path, "text": text, "fields": fields, "sections": sections, "id": fields.get("Spine ID", ""),
                                                  "parent": link(path, fields.get("Parent spine", ""), cache), "rows": rows}
    return cache[path]


def find_root(repo: Path, cache: dict, docs: list[Path] | None = None) -> Path | None:
    repo = cache.setdefault(None, repo.resolve())
    declared = ROOT_LINE.search(read(repo / "AGENTS.md"))
    if declared:
        return next((p.resolve() for p in [repo / declared.group(1).rstrip(".")] if p.is_file()), None)
    roots = (p for p in docs or goal_docs(repo) if (f := meta(p, cache)["fields"]).get("Spine Type", "").lower() == "root" or f.get("Root spine", "").lower() == "self")
    return next((p.resolve() for p in roots), None)


def parent_file(path: Path, cache: dict) -> Path | None:
    m = meta(path, cache)
    return m["parent"] if m and m["parent"] and meta(m["parent"], cache) else None


def problems(repo: Path, path: Path, cache: dict) -> list[str] | None:
    """Why ``path`` is not a consistent node of the tree (None: the repo has no root spine). Walks up one chain only."""
    root = find_root(repo, cache)
    if root is None:
        return None
    out, cur, seen = [], path.resolve(), set()
    while cur != root:
        m = meta(cur, cache)
        parent = parent_file(cur, cache)
        if not m["id"]:
            return out + [f"{cur.name}: no Spine ID header"]
        if parent is None or cur in seen:
            return out + [f"{cur.name}: Parent spine missing or not a file, so not reachable from the root"]
        out += [f"{cur.name}: {p}" for p in link_problems(m, meta(parent, cache))]
        seen.add(cur)
        cur = parent
    return out


def scan(repo: Path, refs: bool = True) -> dict:
    with D.remembering():
        return _scan(repo, refs)


def _scan(repo: Path, refs: bool) -> dict:
    cache = {None: (repo := repo.resolve())}
    docs = [p.resolve() for p in goal_docs(repo)]
    root = find_root(repo, cache, docs)
    rel = lambda p: os.path.relpath(p, repo)  # noqa: E731
    header_kids: dict[Path, list[Path]] = {}
    for d in docs:
        if parent_file(d, cache):
            header_kids.setdefault(meta(d, cache)["parent"], []).append(d)
    nodes: dict[str, dict] = {}
    mismatches: list[dict] = []
    title = lambda m, fallback: re.sub(r"^(EPIC|SPINE):\s*", "", t.group(1)) if (t := re.search(r"(?m)^# (.+)", m["text"])) else fallback  # noqa: E731

    def visit(path: Path) -> str:
        m = meta(path, cache)
        status = D.status_word(m["text"])
        dod = D.criteria(m["text"], "Definition Of Done") or D.criteria(m["text"], "Done means")
        node = nodes[rel(path)] = {"id": m["id"], "path": rel(path), "title": title(m, path.stem), "parent": rel(m["parent"]) if parent_file(path, cache) else None,
                                   "type": m["fields"].get("Spine Type", "").lower() or ("root" if path == root else ""),
                                   "status": status, "rollup_status": status, "dod": dod, "outcome": v.outcome(m["text"]), "current_state": current_state(m["sections"]), "waiting_on": asks(m["text"], path, repo), "waits_on": waits(m["text"]),
                                   "team": P.team_json(v.table_rows(m["sections"].get("Team", ""))), "standing": S.info(m["fields"], m["sections"], v.parse_table),
                                   "grants": [{**g, "source": rel(path), "inherited": False} for g in grants(m["text"], path, repo)], "children": [],
                                   "superseded_by": rel(sup) if (sup := link(path, m["fields"].get("Superseded by", ""), cache)) else None, **D.fields(m["text"], path == root)}
        if node["parent"]:  # a parent's grants apply to every descendant (standing-approvals.md)
            node["grants"] += [{**g, "inherited": True} for g in nodes[node["parent"]]["grants"]]
        kids = list(header_kids.get(path, []))
        for _, target in m["rows"]:
            tm = meta(target, cache) if target else None
            other = parent_file(target, cache) if tm else None
            if tm is None:
                mismatches.append({"path": rel(path), "parent": None, "problem": "Spine Map row points at a missing file"})
            elif other not in (None, path):
                mismatches.append({"path": rel(target), "parent": rel(path), "problem": f"listed in this Spine Map but its Parent spine is {rel(other)}"})
            elif target not in kids:
                kids.append(target)
        for kid in kids:
            if rel(kid) not in nodes:
                nodes[rel(kid)] = {}  # reserve: guards cycles
                visit(kid)
                node["children"].append(rel(kid))
                mismatches.extend({"path": rel(kid), "parent": rel(path), "problem": p} for p in link_problems(meta(kid, cache), m))
        node.update(R.fields(status, [nodes[c]["status"] for c in node["children"]]))
        node["contributes"] = D.contributes(v.table_rows(m["sections"].get("Spine Map", "")), lambda cell: link(path, cell, cache), rel, node["children"])
        node["rollup_status"] = rollup(status, [nodes[c]["rollup_status"] for c in node["children"]], dod) if node["children"] or dod else status
        return node["rollup_status"]

    if root:
        visit(root)
    queue = [d for d in docs if rel(d) not in nodes]
    for d in queue:  # docs a goal links as children are goal docs too
        queue += [t for _, t in meta(d, cache)["rows"] if t and t.suffix == ".md" and t.is_file() and rel(t) not in nodes and t not in queue]
    epics = set(docs) | {repo / p for p in nodes} | set(queue)
    for n in nodes.values():
        n["pages"] = D.pages(repo, repo / n["path"], epics)
    used = uses([meta(repo / p, cache)["text"] for p in nodes])
    for g in (g for n in nodes.values() for g in n["grants"]):
        g["uses"] = used.get(g["code"], 0)
    if refs:  # `waits on` states: this repo's asks, else the sibling checkout `../<repo>`
        resolve(repo, list(nodes.values()), meta(root, cache)["text"] if root else "")
    orphan_pages, like_epic = D.page_report(repo, [repo / p for p in nodes] if root else [], epics, {repo / q["path"] for n in nodes.values() for q in n["pages"]})
    orphans = [{"path": rel(d), "title": title(meta(d, cache), d.stem), "reason": "not reachable from the root" if meta(d, cache)["id"] else "no Spine ID header"} for d in queue]
    return {"root": rel(root) if root else None, "nodes": list(nodes.values()), "orphans": orphans, "mismatches": mismatches,
            "orphan_pages": orphan_pages, "looks_like_epic": like_epic, "stale": stale(repo, list(nodes.values())),
            "personas": P.roster(repo, list(nodes.values()), {n["path"]: v.table_rows(meta(repo / n["path"], cache)["sections"].get("Issue Ledger", "")) for n in nodes.values()})}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--active", action="store_true", help="list open goals, one line each (stale marked)")
    parser.add_argument("--bind", nargs="?", const="", metavar="EPIC", help="print the bind view of EPIC (default: root) and its ancestors")
    args = parser.parse_args()
    if args.bind is not None:
        from bind import bind  # noqa: E402  (bind.py imports this module)
        print(bind(Path(args.repo).resolve(), args.bind or None))
        return 0
    log = scan(Path(args.repo))
    print(json.dumps({**log, "next_code": next_of(log)}, indent=2) if args.json else active(log) if args.active else render(log))
    return 0


if __name__ == "__main__":
    sys.exit(main())
