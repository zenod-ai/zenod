#!/usr/bin/env python3
"""Deploy-gate and PR/CI-policy checks for ``auto_return`` (pure functions, no git, no network). When in doubt: no merge.

A repo may declare ``Deploy gate: <paths/globs>`` (AGENTS.md block and/or root spine): a push to main touching those paths rolls
a production deployment, so they go through PR/CI, never the background auto-merge. ``repo_sync.field`` reads only the first
token of a value, so the whole line is read here, from every occurrence in the text.

- ``Deploy gate:`` entries (split on commas, semicolons, spaces) must each be a repo-relative path prefix or glob (``*``, ``?``,
  ``**``); an entry without ``/`` matches that name at any depth. Anything else (a bare word such as a branch name, prose, a
  URL, ``..``, an absolute path, braces) makes the gate unparseable: auto-merge is blocked for the whole repo. ``none``/``n/a``/
  ``-`` or an empty value declare no gate. Matching is case-insensitive (more blocking, never less).
- An ``Integration policy:`` that mentions a PR or CI (``main-direct via self-merged CI-gated PR``) blocks auto-merge entirely.
"""

from __future__ import annotations

import re
from functools import lru_cache

LINE = r"^[ \t>*_-]*{}[*_ ]*:[*_ \t`]*(.*)$"
NONE = {"", "none", "n/a", "na", "-", "no", "no gate"}
PATHISH = re.compile(r"^[A-Za-z0-9._@+~/*?-]+$")
PR_CI = re.compile(r"(?<![a-z])(prs?|pull[ -]requests?|ci)(?![a-z])", re.IGNORECASE)


def values(text: str, name: str) -> list[str]:
    """The rest of every ``name:`` line (markdown/backtick noise stripped), in document order."""
    found = re.findall(LINE.format(re.escape(name)), text, re.MULTILINE | re.IGNORECASE)
    return [v.replace("`", " ").strip() for v in found]


def entry_ok(entry: str) -> bool:
    if not PATHISH.match(entry) or entry.startswith(("/", "~", "origin/", "refs/")) or ".." in entry.split("/"):
        return False
    return "/" in entry or any(c in entry for c in "*?") or bool(re.search(r"\w\.\w+$", entry)) or entry.startswith(".")


def gate(text: str) -> tuple[list[str], str | None]:
    """(entries, problem): the declared gate entries, or a problem text when the value cannot be read confidently."""
    entries: list[str] = []
    for value in values(text, "Deploy gate"):
        if value.lower().strip(" .") in NONE:
            continue
        for raw in re.split(r"[,;\s]+", value):
            entry = raw.strip().removeprefix("./").rstrip(".,")
            if not entry:
                continue
            if not entry_ok(entry):
                return [], f"the Deploy gate value ({value[:60]!r}) is not only paths or globs (at {entry[:30]!r})"
            entries.append(entry)
    return entries, None


def policy_problem(text: str) -> str | None:
    """A reason when an ``Integration policy:`` line mentions a PR or CI (the repo merges through PR/CI, not by auto-merge)."""
    for value in values(text, "Integration policy"):
        if PR_CI.search(value):
            return f"its Integration policy mentions a PR/CI gate ({value[:60]!r})"
    return None


@lru_cache(maxsize=256)
def pattern(entry: str) -> re.Pattern[str]:
    out, i, e = [], 0, entry.lower()
    while i < len(e):
        if e.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif e.startswith("**", i):
            out.append(".*")
            i += 2
        else:
            out.append("[^/]*" if e[i] == "*" else "[^/]" if e[i] == "?" else re.escape(e[i]))
            i += 1
    return re.compile("".join(out))


def hit(entry: str, path: str) -> bool:
    """Whether ``path`` is under, or matches, ``entry`` (a directory entry covers everything below it)."""
    parts = path.lower().split("/")
    if "/" not in entry:
        return any(pattern(entry).fullmatch(p) for p in parts)
    anchored = pattern(entry.rstrip("/"))
    return any(anchored.fullmatch("/".join(parts[: i + 1])) for i in range(len(parts)))


def touched(entries: list[str], paths: list[str]) -> str | None:
    """The first gate entry that any of ``paths`` touches."""
    return next((e for e in entries if any(hit(e, p) for p in paths)), None)
