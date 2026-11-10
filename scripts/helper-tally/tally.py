#!/usr/bin/env python3
"""EPIC-14 S30: a week of helpers and the quick index on the owner's memory, counted every day (read-only).

    tally.py collect          read new Zenod log lines on VPS1 (counts only), keep them privately, redraw the page
    tally.py daily [DATE]     write DATE's counts (default: yesterday UTC) to the repo, commit and push them
    tally.py --remote MARKS   (runs on VPS1 over ssh, MARKS base64 JSON; never by hand)

What it reads, and nothing else:
- Zenod's container log on VPS1 through the read-only `sudo docker logs --since --until --timestamps` form the
  host allows. Only the content-free lines the app writes for this are kept, parsed into fields on VPS1 so no
  raw line crosses: `[persona] tenant=… <id> <trigger> <status>: … usd=… suggestions=…` (one per helper run),
  `[persona] tenant=… switched-on=…` (once a day), `[inbox-tap] tenant=… helper=… kind=… action=…` (one per
  tap on a real card), `[read-as] tenant=… shown=N | corrected to=…`, `[quick-index] tenant=… …: calls=… usd=…`
  and `[llm-usage] … feature=desk … cost_usd=…` (the memory desk, no tenant on that line).
- The read-only clone of the owner's vault on VPS3: each helper's notes for the day (`Personas/<id>/<date>.md`)
  and the memory desk's commits, for the private page's examples only.

Where it writes: the private state and page under ~/zenod-eval/s30 and ~/zenod-evidence-pages/e14-s30-private
(tailnet only), and, once a day, counts only to docs/evidence/e14-s30/tally.jsonl in the public repo. The owner's
tenant id lives in the private config (`owner_tenant`), never in the repo.
"""
import datetime as dt
import html
import base64
import json
import os
import re
import subprocess
import sys

UTC = dt.timezone.utc
ZENOD_SVC = "zenod-mt-fxpzoo"
HOME = os.path.expanduser("~")
STATE = os.environ.get("S30_STATE", f"{HOME}/zenod-eval/s30")
PAGE = os.environ.get("S30_PAGE", f"{HOME}/zenod-evidence-pages/e14-s30-private/index.html")
VAULT = os.environ.get("S30_VAULT", "/var/lib/vps3-scratch/t3agent/github/obsidian-brain")
REPO_URL = os.environ.get("S30_REPO_URL", "https://github.com/zenod-ai/zenod.git")
RUN_ID = "run_a14a66e8-7c20-4a1b-8d02-f829acdab8ee"
HELPERS = {
    "weekly-recap": "Weekly recap", "open-loops": "Open loops finder", "people-follow-ups": "People and follow-ups",
    "topic-gardener": "Topic gardener", "ideas-digest": "Ideas digest", "memory-health": "Health of your memory",
}
SLUG_TO_ID = {re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"): hid for hid, name in HELPERS.items()}
TAPS = {"do": "Do it", "change": "Change", "not-now": "Not now", "not-now-reason": "Not now with a reason",
        "feedback": "typed feedback", "voice-feedback": "voice note", "bring-back": "Bring it back", "dismiss": "Got it",
        "undo": "Undo", "answer": "answered", "answer-words": "answered in words", "followup": "follow-up"}


def now() -> dt.datetime:
    return dt.datetime.now(UTC)


def iso(t: dt.datetime) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_ts(s):
    m = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)", s or "")
    return dt.datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=UTC) if m else None


# ------------------------------------------------------------------------------------- parse (VPS1 and tests)

def parse_line(rest: str):
    """One log line into a content-free event, or None. Only fixed fields are kept."""
    m = re.match(r"\[persona\] tenant=(\S+) ([a-z0-9-]+) (schedule|manual) (\w+): steps=(\d+) calls=(\d+) "
                 r"tokens=(\d+)/(\d+) usd=([\d.]+)(?: suggestions=(\d+) findings=(\d+) questions=(\d+))?", rest)
    if m:
        return {"e": "run", "tenant": m[1], "helper": m[2], "trigger": m[3], "status": m[4], "calls": int(m[6]),
                "in": int(m[7]), "out": int(m[8]), "usd": float(m[9]),
                **({"suggestions": int(m[10]), "findings": int(m[11]), "questions": int(m[12])} if m[10] else {"uncounted": 1})}
    m = re.match(r"\[persona\] tenant=(\S+) switched-on=(\S+)", rest)
    if m:
        on = []
        for part in ([] if m[2] == "none" else m[2].split(",")):
            p = part.split(":", 2)
            if len(p) == 3 and re.fullmatch(r"[a-z0-9-]+", p[0]):
                on.append({"helper": p[0], "every": p[1][:12], "next": p[2][:17]})
        return {"e": "roster", "tenant": m[1], "on": on}
    m = re.match(r"\[inbox-tap\] tenant=(\S+) helper=([a-z0-9-]+) kind=(\w+) action=([a-z-]+) item=([\w-]+)", rest)
    if m:
        return {"e": "tap", "tenant": m[1], "helper": m[2], "kind": m[3], "action": m[4], "item": m[5][:40]}
    m = re.match(r"\[read-as\] tenant=(\S+) shown=(\d+)", rest)
    if m:
        return {"e": "readas", "tenant": m[1], "shown": int(m[2])}
    m = re.match(r"\[read-as\] tenant=(\S+) corrected to=(place|none)", rest)
    if m:
        return {"e": "readas-fix", "tenant": m[1], "to": m[2]}
    m = re.match(r"\[quick-index\] tenant=(\S+) (\w+): calls=(\d+) names\+(\d+) usd=([\d.]+)", rest)
    if m:
        return {"e": "index", "tenant": m[1], "pass": m[2], "calls": int(m[3]), "usd": float(m[5])}
    m = re.match(r"\[llm-usage\] .*feature=desk .*cost_usd=([\d.]+)", rest)
    if m:
        return {"e": "desk-call", "usd": float(m[1])}
    return None


# ------------------------------------------------------------------------------------------------ VPS1 side

def remote(state_json: str) -> None:
    """Read each Zenod container's log from where the last read stopped; print events and the new marks."""
    sudo = ["sudo", "-n"]
    marks = json.loads(base64.b64decode(state_json).decode() if state_json else "{}")
    since_floor = parse_ts(marks.pop("_floor", None) or "") or (now() - dt.timedelta(hours=26))

    def sh(cmd):
        return subprocess.run(cmd, capture_output=True, text=True, timeout=180).stdout

    ids = sh(sudo + ["docker", "ps", "-aq", "--no-trunc"]).split()
    fmt = "{{.Id}}|{{.Name}}|{{.RestartCount}}|{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}|{{json .State}}"
    out = {"events": [], "marks": {}, "containers": 0, "failed": 0}
    until = now() - dt.timedelta(seconds=2)
    for line in (sh(sudo + ["docker", "inspect", "--format", fmt] + ids).splitlines() if ids else []):
        p = line.split("|", 5)
        if len(p) < 6 or not p[1].lstrip("/").startswith(ZENOD_SVC + "."):
            continue
        cid = p[0]
        state = json.loads(p[5])
        started = parse_ts(state.get("StartedAt")) or since_floor
        frm = parse_ts(marks.get(cid, "")) or max(since_floor, started - dt.timedelta(seconds=1))
        if frm >= until:
            out["marks"][cid] = iso(frm)
            continue
        out["containers"] += 1
        r = subprocess.run(sudo + ["docker", "logs", "--since", iso(frm), "--until", iso(until), "--timestamps", cid],
                           capture_output=True, text=True, timeout=180)
        if r.returncode:
            out["failed"] += 1
            out["marks"][cid] = iso(frm)
            continue
        for raw in (r.stdout + r.stderr).splitlines():
            ts, _, rest = raw.partition(" ")
            ev = parse_line(rest)
            if ev:
                ev["at"] = ts[:19] + "Z"
                ev["c"] = cid[:12]
                out["events"].append(ev)
        out["marks"][cid] = iso(until)
    print(json.dumps(out))


# ------------------------------------------------------------------------------------------------ VPS3 side

def load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1, sort_keys=True)
    os.replace(tmp, path)


def events():
    out = []
    try:
        with open(f"{STATE}/events.jsonl") as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        pass
    return out


def collect() -> int:
    os.umask(0o077)
    os.makedirs(STATE, exist_ok=True)
    marks = load(f"{STATE}/marks.json", {})
    send = dict(marks)
    if not marks:
        send["_floor"] = os.environ.get("S30_FLOOR", "")
    src = open(os.path.abspath(__file__)).read()
    r = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "hetzner_vps_1", "python3", "-",
                        "--remote", base64.b64encode(json.dumps(send).encode()).decode()], input=src, capture_output=True, text=True, timeout=600)
    try:
        got = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        print("remote read failed", file=sys.stderr)
        return 1
    seen = {(e.get("at"), e.get("c"), json.dumps({k: v for k, v in e.items() if k not in ("at", "c")}, sort_keys=True))
            for e in events()[-5000:]}
    fresh = []
    for ev in got["events"]:
        key = (ev.get("at"), ev.get("c"), json.dumps({k: v for k, v in ev.items() if k not in ("at", "c")}, sort_keys=True))
        if key not in seen:
            seen.add(key)
            fresh.append(ev)
    with open(f"{STATE}/events.jsonl", "a") as f:
        for ev in fresh:
            f.write(json.dumps(ev, sort_keys=True) + "\n")
    marks.update(got["marks"])
    save(f"{STATE}/marks.json", marks)
    cov = load(f"{STATE}/coverage.json", {})
    cov.setdefault("from", iso(now()))
    cov["last"] = iso(now())
    cov["reads"] = cov.get("reads", 0) + 1
    cov["failedReads"] = cov.get("failedReads", 0) + got.get("failed", 0)
    save(f"{STATE}/coverage.json", cov)
    print(f"collect: {len(fresh)} new events from {got['containers']} container(s), {got['failed']} failed reads")
    page()
    return 0


def helper_id(slug_or_id: str) -> str:
    return SLUG_TO_ID.get(slug_or_id, slug_or_id)


def day_counts(evs, day: str, owner: str | None) -> dict:
    """Counts only, for the owner's account (or every account when no owner is set)."""
    mine = lambda e: owner is None or e.get("tenant") == owner
    blank = lambda: {"runs": 0, "scheduled": 0, "manual": 0, "skipped": 0, "failed": 0, "suggestions": 0,
                     "findings": 0, "questions": 0, "uncounted": 0, "calls": 0, "usd": 0.0, "taps": {}}
    helpers = {hid: blank() for hid in HELPERS}
    out = {"date": day, "helpers": helpers, "readAs": {"shown": 0, "messages": 0, "corrected": 0, "correctedToNone": 0},
           "index": {"updates": 0, "calls": 0, "usd": 0.0}, "desk": {"calls": 0, "usd": 0.0}, "switchedOn": None,
           "otherAccounts": {"runs": 0, "taps": 0}}
    for e in evs:
        if not (e.get("at") or "").startswith(day):
            continue
        if e["e"] == "desk-call":
            out["desk"]["calls"] += 1
            out["desk"]["usd"] += e["usd"]
            continue
        if not mine(e):
            if e["e"] == "run":
                out["otherAccounts"]["runs"] += 1
            if e["e"] == "tap":
                out["otherAccounts"]["taps"] += 1
            continue
        if e["e"] == "run":
            h = helpers.setdefault(e["helper"], blank())
            if e["status"] == "skipped":
                h["skipped"] += 1
            else:
                h["runs"] += 1
                h["scheduled" if e["trigger"] == "schedule" else "manual"] += 1
                if e["status"] == "failed":
                    h["failed"] += 1
            for k in ("suggestions", "findings", "questions", "uncounted", "calls"):
                h[k] += e.get(k, 0)
            h["usd"] += e["usd"]
        elif e["e"] == "tap":
            h = helpers.setdefault(helper_id(e["helper"]), blank())
            h["taps"][e["action"]] = h["taps"].get(e["action"], 0) + 1
        elif e["e"] == "readas":
            out["readAs"]["messages"] += 1
            out["readAs"]["shown"] += e["shown"]
        elif e["e"] == "readas-fix":
            out["readAs"]["corrected"] += 1
            if e["to"] == "none":
                out["readAs"]["correctedToNone"] += 1
        elif e["e"] == "index":
            out["index"]["updates"] += 1
            out["index"]["calls"] += e["calls"]
            out["index"]["usd"] += e["usd"]
        elif e["e"] == "roster":
            out["switchedOn"] = [o["helper"] + ":" + o["every"] for o in e["on"]]
    for h in helpers.values():
        h["usd"] = round(h["usd"], 5)
    out["index"]["usd"] = round(out["index"]["usd"], 5)
    out["desk"]["usd"] = round(out["desk"]["usd"], 5)
    return out


def schedule_check(evs, owner: str | None, at: dt.datetime) -> list[dict]:
    """Each switched-on helper's announced next wake: did a scheduled run (or a skip) follow it?
    A wake is judged once its off-peak window plus slack (8 hours after the announced time) has passed."""
    mine = [e for e in evs if owner is None or e.get("tenant") == owner]
    due = {}
    for e in mine:
        if e["e"] == "roster":
            for o in e["on"]:
                t = parse_ts(o["next"].replace("Z", ":00Z"))
                if t:
                    due[(o["helper"], o["next"])] = (o["helper"], t, o["every"])
    out = []
    for helper, t, every in sorted(due.values(), key=lambda x: (x[1], x[0])):
        ran = [e for e in mine if e["e"] == "run" and e["helper"] == helper and e["trigger"] == "schedule"
               and parse_ts(e["at"]) and t - dt.timedelta(minutes=10) <= parse_ts(e["at"]) <= t + dt.timedelta(hours=8)]
        verdict = "ran" if any(r["status"] != "skipped" for r in ran) else "skipped, nothing new" if ran else \
            "waiting" if at < t + dt.timedelta(hours=8) else "missed"
        out.append({"helper": helper, "every": every, "due": iso(t), "verdict": verdict,
                    "status": ran[0]["status"] if ran else None})
    return out


def vault_examples(day: str) -> dict:
    """The owner's helper notes and desk jobs for a day, from the read-only vault clone (private page only)."""
    out = {"notes": {}, "desk": []}
    try:
        subprocess.run(["git", "-C", VAULT, "fetch", "-q", "origin"], timeout=120, check=False)
        for hid in HELPERS:
            r = subprocess.run(["git", "-C", VAULT, "show", f"origin/main:Personas/{hid}/{day}.md"],
                               capture_output=True, text=True, timeout=30)
            if r.returncode == 0:
                out["notes"][hid] = r.stdout
        nxt = (dt.date.fromisoformat(day) + dt.timedelta(days=1)).isoformat()
        r = subprocess.run(["git", "-C", VAULT, "log", "origin/main", f"--since={day}T00:00:00Z", f"--until={nxt}T00:00:00Z",
                            "--format=%h %ad %s", "--date=format-local:%H:%M", "--grep=^memory desk", "--grep=[Uu]ndo",
                            "--grep=^Revert"], capture_output=True, text=True, timeout=60, env={**os.environ, "TZ": "UTC"})
        out["desk"] = [line for line in r.stdout.splitlines() if line.strip()]
    except Exception as error:  # the page still shows the counts
        out["error"] = str(error)[:200]
    return out


def page() -> None:
    cfg = load(f"{STATE}/config.json", {})
    owner = cfg.get("owner_tenant")
    evs = events()
    t = now()
    start = dt.date.fromisoformat(cfg.get("week_from", "2026-11-10"))
    days = []
    d = start
    while d <= t.date() and len(days) < 14:
        days.append(d.isoformat())
        d += dt.timedelta(days=1)
    counts = [day_counts(evs, day, owner) for day in days]
    sched = schedule_check(evs, owner, t)
    cov = load(f"{STATE}/coverage.json", {})
    e = html.escape
    o = [f"<h1>Your helpers and the quick index, day by day</h1>",
         f"<p>Counted from {e(cov.get('from', '?'))} (production log, counts only), last read {e(cov.get('last', '?'))}. "
         f"Only your account. The verdict on which helper earned its place comes on 17 November.</p>"]
    o.append("<h2>Each helper, every day</h2><table><tr><th>Day</th><th>Helper</th><th>Runs</th><th>Skipped</th>"
             "<th>Failed</th><th>Suggestions</th><th>Findings</th><th>Your taps</th><th>Cost</th></tr>")
    for c in counts:
        for hid, h in c["helpers"].items():
            if not (h["runs"] or h["skipped"] or h["taps"]):
                continue
            taps = ", ".join(f"{TAPS.get(k, k)} {v}" for k, v in sorted(h["taps"].items())) or "none"
            posted = lambda k: f"{h[k]}" + (f", {h['uncounted']} runs before counting" if h["uncounted"] else "")
            o.append(f"<tr><td>{c['date']}</td><td>{e(HELPERS.get(hid, hid))}</td><td>{h['runs']} "
                     f"({h['scheduled']} on schedule)</td><td>{h['skipped']}</td><td>{h['failed']}</td><td>{posted('suggestions')}</td>"
                     f"<td>{posted('findings')}</td><td>{e(taps)}</td><td>${h['usd']:.4f}</td></tr>")
    o.append("</table>")
    o.append("<h2>Quick index and Read as</h2><table><tr><th>Day</th><th>Messages with a Read as</th><th>Readings shown</th>"
             "<th>You corrected</th><th>Index updates</th><th>Index cost</th><th>Desk cost</th></tr>")
    for c in counts:
        o.append(f"<tr><td>{c['date']}</td><td>{c['readAs']['messages']}</td><td>{c['readAs']['shown']}</td>"
                 f"<td>{c['readAs']['corrected']}</td><td>{c['index']['updates']}</td><td>${c['index']['usd']:.4f}</td>"
                 f"<td>${c['desk']['usd']:.4f}</td></tr>")
    o.append("</table>")
    o.append("<h2>Do the switched-on helpers run on schedule?</h2>")
    if sched:
        o.append("<table><tr><th>Helper</th><th>How often</th><th>Due</th><th>What happened</th></tr>")
        for s in sched:
            o.append(f"<tr><td>{e(HELPERS.get(s['helper'], s['helper']))}</td><td>{e(s['every'])}</td><td>{e(s['due'])}</td>"
                     f"<td>{e(s['verdict'])}</td></tr>")
        o.append("</table>")
    else:
        o.append("<p>No schedule announced yet: the app says which helpers are on once a day, from the first start "
                 "after this change.</p>")
    o.append("<h2>Examples: what each helper wrote, day by day</h2>")
    for day in reversed(days[-3:]):
        ex = vault_examples(day)
        o.append(f"<h3>{day}</h3>")
        if not ex["notes"] and not ex["desk"]:
            o.append("<p>Nothing in your memory from the helpers or the desk that day.</p>")
        for hid, text in ex["notes"].items():
            o.append(f"<p><b>{e(HELPERS[hid])}</b></p><pre>{e(text[:2500])}</pre>")
        if ex["desk"]:
            o.append("<p><b>Memory desk jobs and undos</b></p><ul>" + "".join(f"<li>{e(x)}</li>" for x in ex["desk"]) + "</ul>")
    css = ("body{font:17px/1.55 system-ui,sans-serif;max-width:1040px;margin:40px auto;padding:0 20px;background:#f6f1e7;"
           "color:#1d1b17}h1,h2,h3{font-family:Georgia,serif;font-weight:500}table{border-collapse:collapse;margin:12px 0;"
           "font-size:15px}td,th{border:1px solid #d8d0bf;padding:6px 10px;vertical-align:top}th{background:#ece4d3}"
           "pre{background:#ece4d3;padding:12px;overflow:auto;white-space:pre-wrap;font-size:14px}")
    os.makedirs(os.path.dirname(PAGE), exist_ok=True)
    with open(PAGE + ".tmp", "w") as f:
        f.write(f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
                f"<title>Helpers, day by day</title><style>{css}</style>" + "\n".join(o))
    os.replace(PAGE + ".tmp", PAGE)


def daily(day: str | None) -> int:
    """Write one day's counts (no words, no ids) to the public repo and push them."""
    cfg = load(f"{STATE}/config.json", {})
    day = day or (now() - dt.timedelta(days=1)).date().isoformat()
    row = day_counts(events(), day, cfg.get("owner_tenant"))
    row["schedule"] = [{k: s[k] for k in ("helper", "every", "due", "verdict")}
                       for s in schedule_check(events(), cfg.get("owner_tenant"), now()) if s["due"].startswith(day)]
    cov = load(f"{STATE}/coverage.json", {})
    row["countedFrom"] = cov.get("from")
    repo = f"{STATE}/repo"
    git = lambda *a, **k: subprocess.run(["git", "-C", repo, *a], check=True, timeout=180, **k)
    if not os.path.isdir(f"{repo}/.git"):
        subprocess.run(["git", "clone", "-q", "--depth", "50", REPO_URL, repo], check=True, timeout=600)
    git("fetch", "-q", "origin", "main")
    git("checkout", "-q", "-B", "main", "origin/main")
    path = f"{repo}/docs/evidence/e14-s30/tally.jsonl"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rows = []
    if os.path.exists(path):
        rows = [json.loads(line) for line in open(path) if line.strip()]
    rows = [r for r in rows if r.get("date") != day] + [row]
    rows.sort(key=lambda r: r["date"])
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r, sort_keys=True) + "\n")
    if not subprocess.run(["git", "-C", repo, "status", "--porcelain", "--", path], capture_output=True, text=True).stdout.strip():
        print(f"daily {day}: unchanged")
        return 0
    git("add", "--", "docs/evidence/e14-s30/tally.jsonl")
    git("commit", "-q", "-m", f"E14-S30: helper and quick index tally for {day} (counts only)\n\nRun: {RUN_ID}\n\n"
        "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>", "--", "docs/evidence/e14-s30/tally.jsonl")
    for _ in range(3):
        if subprocess.run(["git", "-C", repo, "push", "-q", "origin", "HEAD:main"], timeout=180).returncode == 0:
            print(f"daily {day}: pushed")
            return 0
        git("pull", "-q", "--rebase", "origin", "main")
    print(f"daily {day}: push failed", file=sys.stderr)
    return 1


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--remote"]:
        remote(args[1] if len(args) > 1 else "")
    elif args[:1] == ["collect"]:
        sys.exit(collect())
    elif args[:1] == ["daily"]:
        rc = collect()
        sys.exit(daily(args[1] if len(args) > 1 else None) or rc)
    elif args[:1] == ["page"]:
        page()
    else:
        print(__doc__)
        sys.exit(2)
