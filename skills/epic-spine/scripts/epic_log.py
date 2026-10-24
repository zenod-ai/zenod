#!/usr/bin/env python3
"""Epic log helpers for spines.py / spine_new.py / session_sync.py: rollup, text views, next code, stale goals."""

from __future__ import annotations

import datetime
import re
import subprocess
import time
from pathlib import Path

import validate_spine as v
from ask_refs import ASK_CODE, MENTION, ask_context, asks, repo_root, unknown, waits  # noqa: F401 (re-exported)

OPEN = ("draft", "ready", "active", "blocked")
CODE = re.compile(r"^(?:EPIC[- ]?|E)(\d+)\b")
STALE_DAYS = 14
STALE_ASK_DAYS = 7
MAX_OPEN_ASKS = 3
# Ask writing (human-asks.md "Writing an ask"; agent_team root L-13/L-14), advisory only:
FUTURE_TRIGGER = re.compile(r"\bwhen pinged\b|\bbefore wave\b|\blater\b|\bonce\b[^.;—]{1,60}?\b(?:is|are) (?:up|live|ready|running|deployed|done)\b", re.I)
NUMBERED_PARTS = re.compile(r"\(1\).*\(2\)", re.S)
MAX_QUESTION_SENTENCE = 200
HUMAN_FORMAT_SINCE = "2026-10-24"  # human-asks.md v6: asks written from this date carry impact, risk, recommend
HUMAN_WAIT = re.compile(r"@?[A-Z][a-z]+(?:'s\b|\s*[:—–(]|\s+-\s)")  # `Jordi: …`, `Jordi — …`, `Jordi's call` (best effort)


def next_code(titles: list[str]) -> int:
    """Highest EPIC-<n> / `E4 ...` / `EPIC 0 ...` title code plus one."""
    return 1 + max((int(m.group(1)) for t in titles if (m := CODE.match(t.strip()))), default=0)


def next_of(log: dict) -> int:
    """The code `spine_new.py` assigns without `--code`: next_code over every goal title in the scan."""
    return next_code([x["title"] for x in log["nodes"] + log["orphans"]])


def rollup(own: str, kids: list[str], dod: list[dict]) -> str:
    """Derived: blocked wins; all children (a superseded child counts as done) and criteria done: done; any progress: active; else the own status."""
    parts = ["done" if k == "superseded" else k for k in kids] + ["done" if d["done"] else "open" for d in dod]
    if own == "blocked" or "blocked" in kids:
        return "blocked"
    if parts and all(p == "done" for p in parts):
        return "done"
    return "active" if own == "active" or "active" in parts or "done" in parts else own or "draft"


def link_problems(child: dict, parent: dict) -> list[str]:
    """The child's header and the parent's Spine Map must agree."""
    rows = [i for i, t in parent["rows"] if t == child["path"]]
    return (["Parent spine header does not name " + parent["path"].name] if child["parent"] != parent["path"] else []) + \
        ([] if child["id"] in rows else ["Spine Map Spine ID differs"] if rows else ["not in the parent's Spine Map"])


def stale(repo: Path, nodes: list[dict], now: float | None = None) -> list[dict]:
    """Active/blocked goals whose file's last commit is 14+ days old (one git call each; untracked files and git timeouts are skipped)."""
    out, now = [], now or time.time()
    for n in nodes:
        if n["status"] in ("active", "blocked"):
            try:
                r = subprocess.run(["git", "log", "-1", "--format=%ct", "--", n["path"]], cwd=repo, capture_output=True, text=True, timeout=5)
            except (subprocess.TimeoutExpired, OSError):  # a loaded host must not crash the scan: this node is unknown, not stale
                continue
            if r.stdout.strip().isdigit() and (days := int((now - int(r.stdout)) // 86400)) >= STALE_DAYS:
                out.append({"path": n["path"], "title": n["title"], "days": days})
    return out


def active(log: dict) -> str:
    """One line per open goal: `<title> — <status> — <path>` (+ stale mark), then `next: EPIC-<n>`, the code a new spine gets."""
    days = {s["path"]: s["days"] for s in log["stale"]}
    return "\n".join([f"{n['title']} — {n['status']} — {n['path']}" + f" — {n['run_state']}{'' if n['runnable'] else ' (not runnable)'}{', has children' if n['has_children'] else ''}" + (f" — STALE {days[n['path']]}d" if n["path"] in days else "")
                      for n in log["nodes"] if n["status"] in OPEN] + [f"next: EPIC-{next_of(log)}"])


def attention(repo: Path) -> str:
    """The background-sync line for stale goals ('' when none, no root spine, or on any error)."""
    try:
        import spines
        if spines.find_root(repo, {}) is None:
            return ""
        n = len(spines.scan(repo)["stale"])
        return f"{repo.name}: {n} goals active but untouched {STALE_DAYS}+ days (spines.py --active)" if n else ""
    except Exception:
        return ""


def render(log: dict) -> str:
    by_path = {n["path"]: n for n in log["nodes"]}
    lines: list[str] = []

    def show(path: str, depth: int) -> None:
        n, pad = by_path[path], "  " * depth
        lines.append(f"{pad}- {n['title']} ({n['path']}) {n['status'] or '?'}" + (f" -> {n['rollup_status']}" if n["rollup_status"] != n["status"] else ""))
        lines.extend(f"{pad}  [{'x' if d['done'] else ' '}] {d['id']} {d['text']}" for d in n["dod"])
        for child in n["children"]:
            show(child, depth + 1)

    if log["root"]:
        show(log["root"], 0)
    else:
        lines.append("no root spine (Root spine: none): nothing is in the tree")
    lines += [f"orphan: {o['path']} ({o['reason']})" for o in log["orphans"]]
    lines += [f"mismatch: {m['path']}: {m['problem']}" for m in log["mismatches"]]
    return "\n".join(lines)


def row_keys(row: dict) -> set[str]:
    first = (row.get("Title", "").split() or [""])[0].rstrip(".:)")
    return {k.lower().strip("#[] ").rstrip(".:)") for k in (first, row.get("Issue", ""), row.get("Ticket", "")) if k.strip()}


def needs_human(row: dict, names: set[str]) -> bool:
    """Best effort, low noise: a Needs cell that is a bare name or @name, or a Needs/Owner cell holding a word that is some ask's `who`."""
    for col, cell in row.items():
        text = v.normalize(cell)
        words = {w.lower() for w in re.findall(r"[\w-]+", text)}
        if col.lower().startswith("needs") and re.fullmatch(r"@?[A-Z][a-z]+", text) and text.lower() not in {"none", "nothing", "tbd", "n/a"}:
            return True
        if col.lower().startswith(("needs", "owner")) and words & names:
            return True
    return False


def writing_issues(a: dict, label: str) -> list[str]:
    """Ask-writing advisories (human-asks.md "Writing an ask"): a future trigger, several numbered parts, an over-long question sentence,
    and (v6, asks since HUMAN_FORMAT_SINCE) no impact, risk or recommend (`recommend` here only for `provide`: other types already warn)."""
    out, q = [], a.get("question") or ""
    m = FUTURE_TRIGGER.search(" ".join(x for x in (q, a.get("steps"), a.get("recommend")) if x))
    if m:
        out.append(f"{label} names a future trigger ('{m.group(0)}'): ask only for the step that blocks now; a later step stays plan text until it is next")
    if NUMBERED_PARTS.search(q):
        out.append(f"{label} lists several numbered parts: one decision per ask; split it, and drop parts that do not block now")
    if any(len(sent) > MAX_QUESTION_SENTENCE for sent in re.split(r"(?<=[.?!])\s+", q)):
        out.append(f"{label} has a question sentence over {MAX_QUESTION_SENTENCE} chars: lead with the decision in plain words (what, why, recommendation); details after")
    lacks = [n for n in ("impact", "risk", "recommend") if not a.get(n) and (n != "recommend" or a.get("ask") == "provide")]
    if lacks and (a.get("since") or "") >= HUMAN_FORMAT_SINCE:
        out.append(f"{label} lacks {', '.join(lacks)}: write it in human format (context, impact, risk, recommend, why <who>) so the human answers in seconds")
    return out


def ask_issues(text: str, today: datetime.date | None = None, repo: Path | None = None) -> list[str]:
    """Advisory (never blocking): the checks of docs/doctrine/human-asks.md (missing field or code, duplicate code, over 3 open, stale, blocked/waiting or next row with no open ask or `waits on` reference; with ``repo``, a same-repo reference to a code that does not exist)."""
    today, issues = today or datetime.date.today(), []
    every = asks(text, Path("-"), Path("-"), issues)
    found = [a for a in every if a["state"] == "open"]
    refs = waits(text)
    named = {a["row"].lower().strip("#[] ").rstrip(".:)") for a in [*found, *refs] if a["row"]}
    names = {a["who"].lower().strip(".,:;") for a in every if a["who"]}
    sections = v.parse_sections(text)
    header, rows = v.parse_table(sections.get("Issue Ledger", ""))
    for row in (dict(zip(header, r)) for r in rows) if "Status" in header else []:
        status = v.normalize(row["Status"]).lower()
        label = (row.get("Title", "").split() or [row.get("Issue", "?")])[0].rstrip(".:)")
        if status.startswith(("blocked", "waiting")) and not row_keys(row) & named:
            issues.append(f"ledger row '{label}' is {status.split()[0]} but no open ask names it (add one under ## Waiting on, `row <id>`)")
        elif status.startswith(("ready", "active")) and not row_keys(row) & named and needs_human(row, names):
            issues.append(f"ledger row '{label}' is next but its Needs/Owner names a human and no open ask names it (a human blocking the next step is an ask)")
    state = v.parse_key_values(sections.get("Current State", ""))
    status, said = state.get("Status", "").lower(), state.get("Waiting on", "")
    if HUMAN_WAIT.match(said) and not MENTION.search(said):
        issues.append(f"Current State `Waiting on: {said[:40]}` names a human but no ask code: write `<who>: <code>, …` (asks of this or another epic), or `nobody` when no human blocks")
    if status.startswith(("blocked", "waiting")) and not found and not refs:
        issues.append(f"Status is {status.split()[0]} but no open ask is under ## Waiting on")
    if len(found) > MAX_OPEN_ASKS:
        issues.append(f"{len(found)} open asks (aim for at most {MAX_OPEN_ASKS}): merge asks one human action resolves, close what no longer blocks")
    decided = sections.get("Decisions", "")
    for r in unknown(refs, repo, text):
        issues.append(f"{'waits on' if r['via'] == 'waits_on' else 'Waiting on:'} {r['ref']}: no ask with that code exists in this repo (check the code, or qualify it `<repo>/<code>`)")
    seen: set[str] = set()
    for a in found:
        label = f"ask {a['code']}" if a["code"] else f"ask '{a['question'][:40]}'"
        required = (("code", a["code"]), ("steps", a["ask"] != "do" or a["steps"]), ("options", a["ask"] != "decide" or a["options"]),
                    ("recommend", a["ask"] == "provide" or a["recommend"]), ("unblocks", a["unblocks"]), ("context", a["context"]))
        issues += [f"{label} is missing {n}" if n != "code" else f"{label} has no code (`[ask <epic code>-A<n>: ...]`)" for n, ok in required if not ok]
        if a["code"] and (a["code"] in seen or re.search(rf"(?<![\w-]){re.escape(a['code'])}(?!\w)", decided)):
            issues.append(f"duplicate ask code {a['code']} (an open ask repeats it, or a Decisions row already cites it): codes are never reused")
        seen.add(a["code"] or "")
        issues += writing_issues(a, label)
        if (today - datetime.date.fromisoformat(a["since"])).days > STALE_ASK_DAYS:
            issues.append(f"stale ask: {label} to @{a['who']} open since {a['since']}")
    return issues
