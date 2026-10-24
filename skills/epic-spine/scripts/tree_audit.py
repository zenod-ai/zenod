#!/usr/bin/env python3
"""``tree_audit.py --repo DIR [--json]``: report-only audit of a repo's epic tree (references/tree-cleanse.md). Changes nothing.

Lists: finished epics with open ledger rows (fix: the printed ``spine_fix.py --close`` sweep), epics whose Status word is missing or
non-standard (root included), non-standard row Status words, stale goals (active/blocked, untouched 14+ days), epics over the
150-line budget, undecided epics (draft/deferred/no Status, untouched 14+ days) and the root goal's Status and age."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import doctrine as D  # noqa: E402
import run_state as R  # noqa: E402
import spines  # noqa: E402
import validate_spine as v  # noqa: E402
from epic_log import STALE_DAYS  # noqa: E402
from close_rows import column, ledger_rows, open_rows  # noqa: E402

SCRIPTS = Path(__file__).resolve().parent


def age(repo: Path, rel: str, now: float) -> int | None:
    """Days since the file's last commit (None: untracked, or git failed)."""
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%ct", "--", rel], cwd=repo, capture_output=True, text=True, timeout=5).stdout.strip()
    except (subprocess.TimeoutExpired, OSError):
        return None
    return int((now - int(out)) // 86400) if out.isdigit() else None


def audit(repo: Path, now: float | None = None) -> dict:
    repo, now = repo.resolve(), now or time.time()
    log = spines.scan(repo, refs=False)
    out: dict = {"repo": str(repo), "finished_with_open_rows": [], "nonstandard_status": [], "nonstandard_row_words": {}, "stale": log["stale"],
                 "over_budget": [], "undecided": [], "root": None}
    words: Counter = Counter()
    for rel in [n["path"] for n in log["nodes"]] + [o["path"] for o in log["orphans"]]:
        text = D.read(repo / rel)
        sections = v.parse_sections(text)
        status = D.status_word(text)
        cells = [c[s].strip() for _, h, c in ledger_rows(text.split("\n")) if 0 < (s := column(h, "Status")) < len(c) - 1]
        words.update(c for c in cells if c and c.lower() not in v.LEDGER_STATUSES)
        if n := open_rows(text):
            out["finished_with_open_rows"].append({"path": rel, "open_rows": n})
        if status not in R.RUN:
            raw = v.parse_key_values(sections.get("Current State", "")).get("Status", "")
            clash = raw.split(" ")[0].lower() in R.RUN  # a standard word the reader drops: another state line contradicts it
            out["nonstandard_status"].append({"path": rel, "status": (raw[:60] + " (conflicting state lines)" * clash) or None})
        if (lines := len(text.splitlines())) > D.MAX_LINES:
            out["over_budget"].append({"path": rel, "lines": lines})
        if status in ("draft", "deferred", "") and (days := age(repo, rel, now)) is not None and days >= STALE_DAYS:
            out["undecided"].append({"path": rel, "status": status or None, "days": days})
        if rel == log["root"]:
            out["root"] = {"path": rel, "status": status or None, "days": age(repo, rel, now)}
    out["nonstandard_row_words"] = dict(words.most_common())
    paths = " ".join(f["path"] for f in out["finished_with_open_rows"])
    out["sweep"] = f"cd {repo} && python3 {SCRIPTS / 'spine_fix.py'} --close --write {paths}" if paths else None
    return out


def render(a: dict) -> str:
    rows = a["finished_with_open_rows"]
    lines = [f"tree audit: {a['repo']}", f"finished epics with open rows: {len(rows)} ({sum(r['open_rows'] for r in rows)} rows)"]
    lines += [f"  {r['path']}: {r['open_rows']} open" for r in rows]
    lines += [f"  fix (preview without --write): {a['sweep']}"] if a["sweep"] else []
    lines += [f"missing/non-standard epic Status: {len(a['nonstandard_status'])}"] + [f"  {s['path']}: {s['status'] or '(none)'}" for s in a["nonstandard_status"]]
    lines += [f"non-standard row Status words: {sum(a['nonstandard_row_words'].values())}"] + [f"  {n} x {w[:70]}" for w, n in a["nonstandard_row_words"].items()]
    lines += [f"stale (active/blocked, {STALE_DAYS}+ days untouched): {len(a['stale'])}"] + [f"  {s['path']}: {s['days']}d" for s in a["stale"]]
    lines += [f"over the {D.MAX_LINES}-line budget: {len(a['over_budget'])}"] + [f"  {o['path']}: {o['lines']} lines" for o in a["over_budget"]]
    lines += [f"undecided (draft/deferred/no Status, {STALE_DAYS}+ days untouched): {len(a['undecided'])}"]
    lines += [f"  {u['path']}: {u['status'] or '(none)'}, {u['days']}d" for u in a["undecided"]]
    root = a["root"]
    lines.append(f"root: {root['path']}: Status {root['status'] or '(none)'}, last commit {root['days'] if root['days'] is not None else '?'}d ago" if root else "root: none")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = audit(Path(args.repo))
    print(json.dumps(result, indent=2) if args.json else render(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
