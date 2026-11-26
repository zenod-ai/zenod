#!/usr/bin/env python3
"""E7-S43: the six Google searches of E7-S41, rerun every week, one dated line on the E7-S41 page.

Jordi started it closing E7-S41 (26 Nov 2026): rerun weekly the six searches (zenod, zenod memory, zenod ai,
zenod mcp, zenod memory app, zenod.dev) signed out through the team browser, the same way E7-S41 measured them,
and add each week's positions to page :9960 as a dated line.

How it reads Google: the Team Browser's own Google search (POST /api/search, 127.0.0.1:8751 is VPS1's Team Browser
over the vps3 tunnel), signed out, one search at a time. That route returns at most 6 results per search (Google
counts requests per address), so a site past 6th is "not in the top 6". E7-S41's baseline line read the top 20.
A search Google refuses (the answer comes from another engine) is retried once, then shown as "no read".

  rank.py run [--repo DIR] [--page-dir DIR] [--commit]

--commit (the timer): works in its own detached worktree at origin/main, commits the data and the page to main
(docs only, main-direct) and pushes; then copies the page to the page host's folder for :9960.
"""
import argparse
import datetime as dt
import html
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

QUERIES = ["zenod", "zenod memory", "zenod ai", "zenod mcp", "zenod memory app", "zenod.dev"]
SHORT = {"zenod memory app": "memory app"}
DATA = "docs/evidence/e7-s41/rank-weekly.json"
PAGE = "docs/evidence/e7-s41/page.html"
PAGE_DIR = "/var/lib/vps3-scratch/t3agent/pages/e7-s41"
BEGIN, END = "<!-- weekly:begin -->", "<!-- weekly:end -->"
BASE = os.environ.get("TEAM_BROWSER_URL", "http://127.0.0.1:8751")
KEY_FILE = os.environ.get("TEAM_BROWSER_KEY_FILE", os.path.expanduser("~/.config/agent-team/browser-api.key"))
CALLER = "zenod E7-S43 weekly Google rank (read only)"
ORIGIN_REPO = "/var/lib/vps3-scratch/t3agent/github/zenod"
STATE = pathlib.Path(os.environ.get("GOOGLE_RANK_STATE", os.path.expanduser("~/.local/state/zenod-google-rank")))
OURS = re.compile(r"(?<![a-z0-9])zenod(?![a-z0-9])", re.I)  # Zenod, zenod.dev, zenod-ai; never Zenodo


def search(query, n=6):
    with open(KEY_FILE) as f:
        key = f.read().strip()
    req = urllib.request.Request(BASE + "/api/search", method="POST",
                                 data=json.dumps({"query": query, "numResults": n}).encode())
    req.add_header("X-Team-Browser-Key", key)
    req.add_header("X-Team-Browser-Caller", CALLER)
    req.add_header("content-type", "application/json")
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def is_site(url):
    host = re.sub(r"^https?://", "", url or "").split("/")[0].lower()
    return host == "zenod.dev" or host.endswith(".zenod.dev")


def score(answer):
    """One search's line: zenod.dev's place, how many of the results are ours, what is first."""
    if not answer or answer.get("engine") != "google":
        return {"pos": None, "ours": None, "first": None, "read": False,
                "engine": (answer or {}).get("engine"), "why": (answer or {}).get("google") or (answer or {}).get("error")}
    res = answer.get("results") or []
    pos = next((i + 1 for i, r in enumerate(res) if is_site(r.get("url"))), None)
    ours = sum(1 for r in res if is_site(r.get("url")) or OURS.search(" ".join(str(r.get(k, "")) for k in ("url", "title", "snippet"))))
    first = res[0].get("title") if res else None
    return {"pos": pos, "ours": ours, "first": first, "read": True, "engine": "google", "depth": len(res)}


def measure(searcher=search, sleep=time.sleep, gap=12, retry_wait=90):
    out = {}
    for i, q in enumerate(QUERIES):
        if i:
            sleep(gap)
        try:
            line = score(searcher(q))
        except Exception as e:  # noqa: BLE001 - an unreachable browser is a "no read", never a crash
            line = score({"error": f"{type(e).__name__}: {str(e)[:120]}"})
        if not line["read"]:
            sleep(retry_wait)
            try:
                line = score(searcher(q))
            except Exception as e:  # noqa: BLE001
                line = score({"error": f"{type(e).__name__}: {str(e)[:120]}"})
        out[q] = line
    return out


def add_week(history, now, results):
    """One line per ISO week: a rerun in the same week replaces that week's line (the baseline line stays)."""
    wk = now.isocalendar()[:2]
    kept = [h for h in history if h.get("baseline") or tuple(dt.date.fromisoformat(h["date"]).isocalendar()[:2]) != wk]
    kept.append({"date": now.date().isoformat(), "at": now.strftime("%Y-%m-%dT%H:%MZ"), "depth": 6, "results": results})
    return kept


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def cell(line, depth):
    if not line or not line.get("read", True):
        return '<span class="muted">no read</span>'
    pos = line.get("pos")
    txt = f"<b>{ordinal(pos)}</b>" if pos else f'<span class="muted">not in top {depth}</span>'
    if line.get("ours"):
        txt += f'<br><span class="muted">{line["ours"]} ours</span>'
    return txt


def punch(history):
    last = history[-1]
    depth = last.get("depth", 6)
    r = last["results"]

    def say(q):
        line = r.get(q) or {}
        if not line.get("read", True):
            return f'"{q}" had no Google read'
        return f'"{q}" {ordinal(line["pos"])}' if line.get("pos") else f'"{q}" not in the top {depth}'

    when = dt.date.fromisoformat(last["date"]).strftime("%-d %b")
    return f"Week of {when}: zenod.dev is {say('zenod memory')} and {say('zenod')}."


def render(history):
    head = "".join(f"<th>{html.escape(SHORT.get(q, q))}</th>" for q in QUERIES)
    rows = []
    for h in reversed(history):
        depth = h.get("depth", 6)
        d = dt.date.fromisoformat(h["date"]).strftime("%-d %b %Y")
        note = f'<br><span class="muted">top {depth}{", E7-S41" if h.get("baseline") else ""}</span>'
        rows.append(f"<tr><td>{d}{note}</td>" + "".join(f"<td>{cell(h['results'].get(q), depth)}</td>" for q in QUERIES) + "</tr>")
    return (f'{BEGIN}\n<section id="weekly">\n<style>.weekly .muted{{color:var(--muted,#8a8378);font-size:13px}}.weekly td,.weekly th{{white-space:nowrap}}</style>\n<h2>Every week: where zenod.dev ranks</h2>\n'
            f'<p class="ps-punch">{html.escape(punch(history))}</p>\n'
            f'<div class="ps-body"><div class="wrap"><table class="weekly">\n<tr><th>Week</th>{head}</tr>\n'
            + "\n".join(rows) +
            "\n</table></div>\n<p>Each line is zenod.dev's place on Google for that search, and how many of the "
            "results are ours (Reddit, Glama, YouTube). Read every Thursday through the team browser, signed out, "
            "from a server in Germany. The weekly read sees Google's top 6.</p></div>\n</section>\n" + END)


def put_section(page, section):
    if BEGIN in page:
        return re.sub(re.escape(BEGIN) + r".*?" + re.escape(END), lambda _: section, page, flags=re.S)
    # first time: right after the plan, before the first-day answer
    return page.replace('<section id="answer">', section + '\n<section id="answer">', 1)


def write(repo, now, results):
    repo = pathlib.Path(repo)
    data = repo / DATA
    history = json.loads(data.read_text()) if data.exists() else []
    history = add_week(history, now, results)
    data.write_text(json.dumps(history, indent=1, ensure_ascii=False) + "\n")
    page = repo / PAGE
    page.write_text(put_section(page.read_text(), render(history)))
    return history


def git(repo, *a, check=True):
    return subprocess.run(["git", "-C", str(repo), *a], check=check, capture_output=True, text=True)


def worktree():
    wt = STATE / "repo"
    git(ORIGIN_REPO, "fetch", "-q", "origin", "main")
    if not (wt / ".git").exists():
        STATE.mkdir(parents=True, exist_ok=True)
        git(ORIGIN_REPO, "worktree", "add", "-q", "--detach", str(wt), "origin/main")
    git(wt, "fetch", "-q", "origin", "main")
    git(wt, "reset", "-q", "--hard", "origin/main")  # its own worktree: nothing of anyone else's lives here
    return wt


def commit(wt, now):
    git(wt, "add", DATA, PAGE)
    if not git(wt, "diff", "--cached", "--quiet", check=False).returncode:
        return "nothing new"
    git(wt, "commit", "-q", "-m", f"E7-S43: weekly Google rank {now.date().isoformat()}\n\n"
        "The six E7-S41 searches, signed out through the team browser; page :9960#weekly.")
    for _ in range(3):
        if git(wt, "push", "-q", "origin", "HEAD:main", check=False).returncode == 0:
            return git(wt, "rev-parse", "--short", "HEAD").stdout.strip()
        git(wt, "fetch", "-q", "origin", "main")
        git(wt, "rebase", "-q", "origin/main")
    raise SystemExit("push to main failed three times")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["run"])
    ap.add_argument("--repo")
    ap.add_argument("--page-dir", default=PAGE_DIR)
    ap.add_argument("--commit", action="store_true")
    a = ap.parse_args(argv)
    now = dt.datetime.now(dt.timezone.utc)
    repo = worktree() if a.commit else pathlib.Path(a.repo or pathlib.Path(__file__).resolve().parents[2])
    results = measure()
    history = write(repo, now, results)
    sha = commit(repo, now) if a.commit else "not committed"
    if a.page_dir and os.path.isdir(a.page_dir):
        shutil.copyfile(repo / PAGE, os.path.join(a.page_dir, "index.html"))
    print(json.dumps({"week": history[-1]["date"], "punch": punch(history), "commit": sha,
                      "results": {q: (r["pos"], r["ours"], r["read"]) for q, r in results.items()}}))


if __name__ == "__main__":
    sys.exit(main())
