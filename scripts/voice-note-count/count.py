#!/usr/bin/env python3
"""EPIC-21 V6: how many of Jordi's EpicTeam voice notes landed in his Zenod, counted every day (read-only).

    count.py            read both sides, redraw the private page, keep one line per day
    count.py --json     the same counts as JSON on stdout, page untouched

Jordi (2026-11-10, Log/2026-11-10.md#^e-449504): "Zenod will have a pretty damn good feel for what's going on in
Epic Team. If he gets like 90% of the voice notes."

What it reads, and nothing else:
- EpicTeam's console database on VPS1 (`~/agent_team_console/console.db`, opened `mode=ro`): per voice note its id,
  world, state, start time and length; per call the same; per forward its state. Never a transcript, only whether
  one exists. Read on VPS1 so no transcript crosses.
- The read-only clone of the owner's vault on VPS3: each forwarded Log entry's `source-id`, whose last part is
  sha256(EpicTeam note id)[:32] (zenod packages/server/src/voiceNoteForward.ts), and its `Source app:` line. A call
  has no audio, so it comes through store_memory with the call id itself as sourceId (EPIC-21 decision 2026-11-11,
  agent_team E42-S47). So a note or call matches its entry exactly, by id, never by time or words.

Where it writes: ~/zenod-eval/v6/history.jsonl (one line per UTC day) and the page
~/zenod-evidence-pages/v6-voice-note-count/index.html (tailnet, http://vps3.taild81fbb.ts.net:8921/v6-voice-note-count/).
Counts only: no transcript, no tenant id of Zenod, no token.
"""
import datetime as dt
import hashlib
import html
import json
import os
import re
import subprocess
import sys

UTC = dt.timezone.utc
HOME = os.path.expanduser("~")
STATE = os.environ.get("V6_STATE", f"{HOME}/zenod-eval/v6")
PAGE = os.environ.get("V6_PAGE", f"{HOME}/zenod-evidence-pages/v6-voice-note-count/index.html")
VAULT = os.environ.get("V6_VAULT", "/var/lib/vps3-scratch/t3agent/github/obsidian-brain")
SINCE = "2026-11-02T00:00:00Z"  # the back-fill (agent_team E42-S42) reaches back to here
TARGET = 0.90
# Agents' test card answers (EPIC-21 V4 evidence), not Jordi's words.
TEST_NOTES = {"vn_8a891947", "vn_e59dac3f"}
# A call this short never got a word in (dialled and hung up).
MIN_CALL_SECONDS = 10
CHANNELS = [("chat", "Chat voice notes"), ("card", "Card answers"), ("call", "Calls")]

REMOTE = r'''
import json, sqlite3, os
c = sqlite3.connect("file:" + os.path.expanduser("~/agent_team_console/console.db") + "?mode=ro", uri=True)
since = %r
notes = c.execute("""SELECT v.id, v.tenant_id, v.state, v.started_at, v.seconds, length(coalesce(v.transcript, '')) > 0,
  f.state, f.last_code FROM voice_notes v LEFT JOIN zenod_voice_forwards f ON f.note_id = v.id
  WHERE v.started_at >= ?""", (since,)).fetchall()
calls = c.execute("""SELECT id, coalesce(tenant_id, 'alpha9'), started_at,
  (julianday(coalesce(ended_at, last_beat_at)) - julianday(started_at)) * 86400,
  transcript_posted_at IS NOT NULL OR length(coalesce(transcript, '')) > 0
  FROM voice_calls WHERE started_at >= ?""", (since,)).fetchall()
print(json.dumps({"notes": notes, "calls": calls}))
'''


def now() -> dt.datetime:
    return dt.datetime.now(UTC)


def iso(t: dt.datetime) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def source_hash(item_id: str) -> str:
    return hashlib.sha256(item_id.encode()).hexdigest()[:32]


def read_console() -> dict:
    r = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "hetzner_vps_1", "python3", "-"],
                       input=REMOTE % SINCE, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise SystemExit(f"console read failed (exit {r.returncode})")
    return json.loads(r.stdout)


def parse_vault_log(text: str) -> dict:
    """Source key -> Source app, for every entry in one Log file that carries a source id: a forward's id hash, or the
    plain EpicTeam id (`call_…`, `vn_…`) a store_memory call sent as sourceId."""
    out = {}
    for block in re.split(r"\n(?=## )", text):
        m = re.search(r"^- source-id: (.+?)\s*$", block, re.M)
        if not m:
            continue
        sid = m.group(1)
        f = re.search(r":forward:[0-9a-f]+:([0-9a-f]{32})$", sid)
        key = f.group(1) if f else sid.rsplit(":", 1)[-1]
        if not f and not re.match(r"(call|vn)_[0-9a-f]+$", key):
            continue
        app = re.search(r"^> Source app: (.+)$", block, re.M)
        out[key] = app.group(1).strip() if app else ""
    return out


def read_vault() -> dict:
    subprocess.run(["git", "-C", VAULT, "fetch", "-q", "origin", "main"], check=True, timeout=120)
    files = subprocess.run(["git", "-C", VAULT, "grep", "-l", "-E", "^- source-id: .*(:forward:|call_|vn_)", "origin/main", "--", "Log/"],
                           capture_output=True, text=True).stdout.split()
    landed = {}
    for ref in files:
        landed.update(parse_vault_log(subprocess.run(["git", "-C", VAULT, "show", ref], capture_output=True,
                                                     text=True, check=True).stdout))
    return landed


def items(console: dict) -> tuple[list, dict]:
    """Jordi's voice notes and calls (channel, id, start), and what was left out and why."""
    kept, skipped = [], {"discarded": 0, "empty": 0, "unfinished": 0, "test": 0, "short call": 0}
    for nid, _world, state, started, _secs, _has_text, _fwd, _code in console["notes"]:
        if nid in TEST_NOTES:
            skipped["test"] += 1
        elif state == "posted":
            kept.append({"channel": "chat", "id": nid, "at": started, "fwd": _fwd, "code": _code})
        elif state == "transcribed":
            kept.append({"channel": "card", "id": nid, "at": started, "fwd": _fwd, "code": _code})
        elif state == "discarded":
            skipped["discarded"] += 1
        elif state == "empty":
            skipped["empty"] += 1
        else:
            skipped["unfinished"] += 1
    for cid, _world, started, secs, _has_text in console["calls"]:
        if (secs or 0) < MIN_CALL_SECONDS:
            skipped["short call"] += 1
        else:
            kept.append({"channel": "call", "id": cid, "at": started, "fwd": None, "code": None})
    return kept, skipped


def is_landed(item_id: str, landed: dict) -> bool:
    return source_hash(item_id) in landed or item_id in landed


def tally(kept: list, landed: dict, since: str) -> dict:
    out = {}
    for key, _label in CHANNELS:
        rows = [k for k in kept if k["channel"] == key and k["at"] >= since]
        hit = [k for k in rows if is_landed(k["id"], landed)]
        out[key] = {"left": len(rows), "landed": len(hit),
                    "waiting": sum(1 for k in rows if not is_landed(k["id"], landed) and k["fwd"] in ("queued", "waiting")),
                    "failed": sum(1 for k in rows if not is_landed(k["id"], landed) and k["fwd"] == "failed"),
                    "never_sent": sum(1 for k in rows if not is_landed(k["id"], landed) and not k["fwd"])}
    left = sum(v["left"] for v in out.values())
    hit = sum(v["landed"] for v in out.values())
    out["all"] = {"left": left, "landed": hit}
    return out


def share(c: dict) -> float | None:
    return c["landed"] / c["left"] if c["left"] else None


def pct(c: dict) -> str:
    s = share(c)
    return "none yet" if s is None else f"{round(s * 100)}%"


def compute(console: dict, landed: dict, at: dt.datetime) -> dict:
    kept, skipped = items(console)
    week = iso(at - dt.timedelta(days=7))
    last_call = max((k["at"] for k in kept if k["channel"] == "call"), default=None)
    return {"at": iso(at), "since": SINCE, "week_from": week, "week": tally(kept, landed, week),
            "all": tally(kept, landed, SINCE), "skipped": skipped, "last_call": last_call}


def gaps(r: dict) -> list[str]:
    out = []
    a = r["all"]
    for key, label in CHANNELS:
        c = a[key]
        miss = c["left"] - c["landed"]
        if not miss:
            continue
        if key == "call" and c["never_sent"] == miss:
            if c["landed"]:
                out.append(f"Calls: {miss} not in your memory yet. EpicTeam sends them and back-fills the rest.")
            else:
                out.append(f"Calls are not sent to Zenod yet: {miss} calls since 2 November, none in your memory. "
                           "EpicTeam is building it.")
            continue
        parts = []
        if c["never_sent"]:
            parts.append(f"{c['never_sent']} never sent")
        if c["waiting"]:
            parts.append(f"{c['waiting']} waiting to be sent")
        if c["failed"]:
            parts.append(f"{c['failed']} failed")
        out.append(f"{label}: {miss} not in your memory yet, " + ", ".join(parts) + ".")
    return out


def save_history(r: dict) -> list:
    os.makedirs(STATE, exist_ok=True)
    path = os.path.join(STATE, "history.jsonl")
    rows = []
    if os.path.exists(path):
        rows = [json.loads(l) for l in open(path) if l.strip()]
    day = r["at"][:10]
    line = {"day": day, "at": r["at"], "week": {k: [v["landed"], v["left"]] for k, v in r["week"].items()},
            "all": {k: [v["landed"], v["left"]] for k, v in r["all"].items()}}
    rows = [x for x in rows if x["day"] != day] + [line]
    with open(path + ".tmp", "w") as f:
        f.writelines(json.dumps(x) + "\n" for x in rows)
    os.replace(path + ".tmp", path)
    return rows


def render(r: dict, history: list) -> str:
    e = html.escape
    w, a = r["week"], r["all"]

    def row(label, c):
        s = share(c)
        cls = "" if s is None else ("ok" if s >= TARGET else "low")
        return (f"<tr><td>{e(label)}</td><td class=n>{c['left']}</td><td class=n>{c['landed']}</td>"
                f"<td class='n {cls}'>{pct(c)}</td></tr>")

    def table(t):
        return ("<table><tr><th></th><th>you left</th><th>in Zenod</th><th>share</th></tr>"
                + "".join(row(label, t[k]) for k, label in CHANNELS) + row("All of them", t["all"]) + "</table>")

    voice_only = {"left": a["chat"]["left"] + a["card"]["left"], "landed": a["chat"]["landed"] + a["card"]["landed"]}
    g = gaps(r)
    sk = r["skipped"]
    hist = "".join(
        f"<tr><td>{e(h['day'])}</td><td class=n>{h['week']['all'][0]} of {h['week']['all'][1]}</td>"
        f"<td class=n>{h['all']['all'][0]} of {h['all']['all'][1]}</td></tr>" for h in reversed(history[-30:]))
    big = pct(w["all"])
    return f"""<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>
<title>Your EpicTeam voice notes in Zenod</title>
<style>
body{{font:17px/1.55 'Instrument Sans',system-ui,sans-serif;max-width:860px;margin:48px auto;padding:0 22px;background:#f6f1e7;color:#1d1b17}}
h1,h2{{font-family:Newsreader,Georgia,serif;font-weight:500}} h1{{font-size:2.1em;line-height:1.15;margin:0 0 8px}}
.big{{font-family:Newsreader,Georgia,serif;font-size:5.2em;line-height:1;color:#1f5b3f;margin:18px 0 4px}}
.sub{{color:#5c5548}} table{{border-collapse:collapse;margin:10px 0 22px;width:100%;font-size:16px}}
td,th{{border-bottom:1px solid #d8d0bf;padding:8px 10px;text-align:left}} th{{font-weight:500;color:#5c5548}}
td.n,th:not(:first-child){{text-align:right}} .ok{{color:#1f5b3f;font-weight:600}} .low{{color:#9a3b1e;font-weight:600}}
ul{{padding-left:20px}} li{{margin:6px 0}} footer{{color:#7a7262;font-size:14px;margin-top:36px}}
</style>
<h1>Your EpicTeam voice notes in Zenod</h1>
<p class=sub>Every voice note you leave in EpicTeam, checked against your Zenod memory by its own id. Refreshed every day.</p>
<div class=big>{e(big)}</div>
<p>of what you said in EpicTeam in the last 7 days is in your Zenod memory. Your aim is 90%.
Chat voice notes and card answers alone: <b>{pct(voice_only)}</b> since 2 November.</p>
<h2>Last 7 days</h2>{table(w)}
<h2>Since 2 November</h2>{table(a)}
<h2>What is missing</h2><ul>{''.join(f'<li>{e(x)}</li>' for x in g) or '<li>Nothing. Every one landed.</li>'}</ul>
<p class=sub>Not counted: {sk['discarded']} notes you discarded, {sk['empty']} empty, {sk['unfinished']} never finished,
{sk['test']} agents' test notes and {sk['short call']} calls hung up within {MIN_CALL_SECONDS} seconds.
{'Last call: ' + e(r['last_call'][:10]) + '.' if r['last_call'] else ''}</p>
<h2>Day by day</h2>
<table><tr><th>Day</th><th>last 7 days</th><th>since 2 November</th></tr>{hist}</table>
<footer>Counted {e(r['at'])}. Read only: EpicTeam's note list and your vault's Log, matched by note id. Nothing is changed.</footer>
"""


def main(argv: list[str]) -> int:
    r = compute(read_console(), read_vault(), now())
    if "--json" in argv:
        print(json.dumps(r, indent=1))
        return 0
    history = save_history(r)
    os.makedirs(os.path.dirname(PAGE), exist_ok=True)
    with open(PAGE + ".tmp", "w") as f:
        f.write(render(r, history))
    os.replace(PAGE + ".tmp", PAGE)
    print(f"{r['at']} week {r['week']['all']['landed']}/{r['week']['all']['left']} "
          f"all {r['all']['all']['landed']}/{r['all']['all']['left']} -> {PAGE}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
