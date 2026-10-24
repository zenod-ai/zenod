#!/usr/bin/env python3
"""Doctrine 2 readers (references/spine-model.md, docs/doctrine/console-contract.md) for spines.py and pre_commit.py: epic detection,
the per-epic fields of ``spines.py --json`` (goal, serves, done_means, contributes, pages, missing_sections, size) and the repo's
orphan / looks-like-epic pages. An epic is a doc titled ``# EPIC-<n>:`` (colon required: ``# EPIC-4 decisions`` is a page) or with a ``Spine ID:`` line; every other .md is a page."""

from __future__ import annotations

import contextlib
import os
import re
from pathlib import Path

import validate_spine as v

SKIP = {"archive", "node_modules", "vendor", "wt", "worktrees", "handoffs", "examples", "fixtures", "test", "tests", "__pycache__"}
CONVENTIONAL = {"readme", "agents", "claude", "gemini", "changelog", "contributing", "license", "security", "code_of_conduct"}
ID_LINE = re.compile(r"(?m)^Spine ID:")
STAMP = re.compile(r"(?m)^# EPIC-\d+:")
TITLE = re.compile(r"EPIC-\d+:\s*\S")
LINK = re.compile(r"\]\(<?([^)\s>#]+)")
DONE = re.compile(rf"- \[([ xX])\] ({v.ID})[ \t]*(.*)")
MAX_LINES, MAX_CELL = 150, 200


_reads: dict[Path, str] | None = None  # set by ``remembering()``: one read per file for the length of a scan


def read(path: Path) -> str:
    if _reads is not None and path in _reads:
        return _reads[path]
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        text = ""
    if _reads is not None:
        _reads[path] = text
    return text


@contextlib.contextmanager
def remembering():
    """Within the block each file is read once (a repo scan reads every doc up to four times, slow on a loaded host); files must not change meanwhile."""
    global _reads
    _reads = {}
    try:
        yield
    finally:
        _reads = None


def is_epic(text: str) -> bool:
    return bool(STAMP.search(text) or ID_LINE.search(text))


def skipped(repo: Path, rel: Path) -> bool:
    """In a skipped folder (archive/, tests/, a dot-dir, ...) or inside a vendored skill (a folder up the path holds SKILL.md)."""
    dirs = rel.parts[:-1]
    return any(d in SKIP or d.startswith(".") for d in dirs) or any((repo.joinpath(*dirs[:i]) / "SKILL.md").is_file() for i in range(len(dirs) + 1))


def docs(repo: Path) -> list[Path]:
    """Every .md the epic log looks at (same skip list as goal docs), sorted per folder."""
    found = []
    for top, dirs, files in os.walk(repo):
        vendored = "SKILL.md" in files
        dirs[:] = [] if vendored else sorted(d for d in dirs if d not in SKIP and not d.startswith("."))
        found += [] if vendored else [Path(top, n).resolve() for n in sorted(files) if n.endswith(".md")]
    return found


def status_word(text: str) -> str:
    m = re.match(r"[a-z]+", v.read_state(text)[0].get("status", "").lower())
    return m.group() if m else ""


def criteria(text: str, name: str) -> list[dict]:
    return [{"id": x.group(2), "text": x.group(3), "done": x.group(1) != " "} for _, line in v.criteria(text, (name,)) if (x := DONE.match(line.strip()))]


def done_means(text: str) -> list[dict]:
    """``## Done means`` outcomes, else the Definition Of Done ones (same shape as ``dod``)."""
    return criteria(text, "Done means") or criteria(text, "Definition Of Done")


def fields(text: str, root: bool = False) -> dict:
    """goal, serves (null for the root), done_means, missing_sections and size of one epic."""
    low = {k.lower(): re.sub(r"(?s)<!--.*?-->", "", s).strip() for k, s in v.parse_sections(text).items()}
    body = lambda *names: next((low[n] for n in names if low.get(n)), None)  # noqa: E731
    title = re.search(r"(?m)^# (.+)", text)
    goal, serves = body("goal", "mission"), None if root else body("serves")
    cells = [c for line in text.splitlines() if line.lstrip().startswith("|") for c in line.strip().strip("|").split("|")]
    missing = [n for n, ok in (("title", title and TITLE.match(title.group(1))), ("goal", goal), ("serves", root or serves), ("done_means", body("done means", "definition of done")),
                               ("status", status_word(text))) if not ok]
    return {"goal": goal, "serves": serves, "done_means": done_means(text), "missing_sections": missing,
            "size": {"lines": len(text.splitlines()), "long_cells": sum(len(c.strip()) > MAX_CELL for c in cells)}}


def contributes(rows: list[dict[str, str]], resolve, rel, kids: list[str]) -> dict[str, str]:
    """Child path -> the Spine Map's one-sentence ``Contributes`` (else ``Purpose``) cell; a child without one is absent."""
    out = {}
    for r in rows:
        target, sentence = resolve(r.get("Spine", "")), v.normalize(r.get("Contributes") or r.get("Purpose") or "")
        if target and rel(target) in kids and not v.is_empty(sentence):
            out[rel(target)] = sentence
    return out


def links(repo: Path, path: Path, text: str) -> list[Path]:
    """Local .md files ``text`` links to (relative to the file's folder, else the repo root)."""
    out = []
    for name in LINK.findall(text):
        if name.endswith(".md") and "://" not in name and not name.startswith("/"):
            found = next((c for base in (path.parent, repo) if (c := (base / name).resolve()).is_file() and c.is_relative_to(repo)), None)
            out += [found] if found and found not in out else []
    return out


def pages(repo: Path, epic: Path, epics: set[Path]) -> list[dict]:
    """Pages (non-epic docs) reachable from ``epic`` by links, at any depth through other pages; ``via`` is the linking leaf."""
    rel = lambda p: os.path.relpath(p, repo)  # noqa: E731
    found, queue, seen = [], [epic], {epic}
    for cur in queue:
        for target in links(repo, cur, read(cur)):
            if target not in seen and target not in epics:
                seen.add(target)
                queue.append(target)
                title = re.search(r"(?m)^# (.+)", read(target))
                found.append({"path": rel(target), "title": title.group(1) if title else target.stem, "via": rel(cur)})
    return found


def looks_like_epic(text: str) -> bool:
    """A page with two or more epic signals: Goal, Done means, checkbox outcomes, Next action, Status."""
    heads = {k.lower() for k in v.parse_sections(text)}
    signals = [heads & {"goal", "mission"}, heads & {"done means", "definition of done"}, v.CHECKBOX_RE.search(text),
               "next action" in heads or re.search(r"(?mi)^next action:", text), "status" in heads or re.search(r"(?mi)^status:", text)]
    return sum(map(bool, signals)) >= 2


def page_report(repo: Path, sources: list[Path], epics: set[Path], reached: set[Path] | None = None) -> tuple[list[str], list[str]]:
    """(orphan_pages, looks_like_epic): pages no source epic reaches; pages that read like an epic. README/AGENTS/CHANGELOG-style files are ignored.
    ``reached`` is the pages of ``sources`` when the caller already holds them (``spines.scan``), else they are computed."""
    rel = lambda p: os.path.relpath(p, repo)  # noqa: E731
    reached = {repo / p["path"] for e in sources for p in pages(repo, e, epics)} if reached is None else reached
    candidates = [p for p in docs(repo) if p not in epics and p.stem.lower() not in CONVENTIONAL]
    return ([rel(p) for p in candidates if p not in reached] if sources else [],
            sorted(rel(p) for p in {*candidates, *reached} if p.stem.lower() not in CONVENTIONAL and looks_like_epic(read(p))) if sources else [])
