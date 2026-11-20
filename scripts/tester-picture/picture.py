#!/usr/bin/env python3
"""The daily Zenod tester picture (EPIC-7 E7-S17).

Jordi, vn_b73d7c41 (20 Nov 22:38Z): "how many testers do we have? How many testers logged in? How many testers are fully
set up, meaning that they have set up their GitHub, they have set up their WhatsApp, that they send at least one message
on WhatsApp, and they saved at least one memory? ... I would like to get some daily state on what's happening with the
testers, and right now I'm lost."

One run (a vps3 user timer, 05:30 Mexico City, 30 min before his 06:00 morning briefing) reads production through VPS1,
where the ops token lives (the zenod-tester-stuck pattern), and writes:

  <out>/<day>/tester-picture.json   the facts, one row per tester by masked key
  <out>/<day>/tester-picture.png    the same as one picture in the house paper style
  <out>/latest.json, latest.png     copies for whoever sends it (agent_team's 06:00 briefing)

Per tester: signed up, logged in in the last 24 h, and four steps (vault set up: GitHub or Google Drive; WhatsApp linked;
at least one WhatsApp note sent; at least one memory saved), the first step not done = where they are stuck, who owns
moving them and what happens next, and the last 24 h of use. Never an email, number, code or note text: a tester is the
last 4 characters of their account id.

Sources, read only: GET /api/ops/testers/progress (this release), else GET /api/ops/testers/whatsapp-setup with
`tester-watch --json --redact` (the steps those two cannot see are shown as "?", never guessed), and the public counts.

  python3 scripts/tester-picture/picture.py            # build today's picture
  python3 scripts/tester-picture/picture.py --dry-run  # print the punchline and the JSON, write nothing
Way back: systemctl --user disable --now zenod-tester-picture.timer
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import urllib.request
from zoneinfo import ZoneInfo

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tester-thanks"))

ROW = "E7-S17"
OWNER = "Zenod Delivery Manager"
MX = ZoneInfo("America/Mexico_City")
OUT = pathlib.Path(os.environ.get("TESTER_PICTURE_OUT", "~/.local/state/zenod-tester-picture")).expanduser()
COUNTS_URL = os.environ.get("ZENOD_PUBLIC_COUNTS", "https://cloud.zenod.dev/api/public/counts")
OPS_HOST = os.environ.get("TESTER_PICTURE_OPS_HOST", "hetzner_vps_1")
HOUSE_DIAGRAM = pathlib.Path(os.environ.get(
    "HOUSE_DIAGRAM", "~/github/agent_team/skills/house-diagram-style/scripts/house_diagram.py")).expanduser()
DAY = dt.timedelta(hours=24)

# The four steps, in Jordi's order (vn_b73d7c41). id, short column title, what stuck here means.
STEPS = [
    ("vault", "Vault", "no vault yet (GitHub or Google Drive not connected)"),
    ("whatsapp", "WhatsApp linked", "WhatsApp not linked"),
    ("message", "Sent a note", "linked, no note sent yet"),
    ("memory", "Saved a memory", "no memory saved yet"),
]
# Who moves a tester who is stuck at a step, and what happens next (plain words, no automatic message to a tester).
NEXT = {
    "vault": "check why the vault is not connected; offer help by email, text first approved by Jordi",
    "whatsapp": "help them link: our own email or call (the next-day email already goes)",
    "message": "offer a first note to send: one sentence, the welcome email already says how",
    "memory": "look at the failed saves, fix ours, then tell them",
}
NEXT_OUR_BUG = "fix our side first (WhatsApp setup failed on our server), then tell them"


def parse_time(value):
    try:
        return dt.datetime.fromisoformat((value or "").replace("Z", "+00:00"))
    except ValueError:
        return None


# ------------------------------------------------------------------ reading (all read only)

def read_sources(ops_call=None, run=subprocess.run, fetch=None):
    """Returns (progress dict or None, whatsapp-setup dict or None, tester-watch rows or None, public counts or None)."""
    if ops_call is None:
        from send import ops as ops_call  # noqa: E402  the same VPS1 ops call as the stuck-sign-up check
    code, progress = ops_call("GET", "/api/ops/testers/progress")
    setup = watch = None
    if code != 200:
        progress = None
        c2, setup = ops_call("GET", "/api/ops/testers/whatsapp-setup")
        setup = setup if c2 == 200 else None
        try:
            r = run(["ssh", "-o", "BatchMode=yes", OPS_HOST, "tester-watch --json --redact --no-stripe"],
                    capture_output=True, text=True, timeout=120)
            watch = json.loads(r.stdout).get("testers") if r.returncode == 0 else None
        except (ValueError, OSError, subprocess.TimeoutExpired):
            watch = None
    try:
        counts = (fetch or fetch_counts)()
    except Exception:  # the counts are context, never a reason to skip the picture
        counts = None
    return progress, setup, watch, counts


def fetch_counts():
    req = urllib.request.Request(COUNTS_URL, headers={"User-Agent": "zenod-tester-picture", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def rows_from_progress(progress):
    since = parse_time(progress.get("lastSeenSince"))
    out = []
    for t in progress.get("testers") or []:
        out.append({
            "key": t["key"], "signed_up_at": t.get("signedUpAt"),
            "vault": bool(t["vault"]["set"]), "vault_provider": t["vault"].get("provider"),
            "whatsapp": bool(t["whatsapp"]["linked"]), "whatsapp_text": t["whatsapp"].get("text"),
            "our_bug": bool(t["whatsapp"].get("ourBug")) and not t["whatsapp"]["linked"],
            "message": t.get("whatsappNotes", 0) > 0, "memory": t.get("memoriesSaved", 0) > 0,
            "notes_24h": t.get("whatsappNotes24h", 0), "saves_24h": t.get("memoriesSaved24h", 0),
            "last_seen_at": t.get("lastSeenAt"), "seen_record_since": progress.get("lastSeenSince"),
            "_since": since,
        })
    return out


def rows_from_fallback(setup, watch):
    """Before this release is live: the WhatsApp step from the setup route, memories from tester-watch; the rest is unknown."""
    by_last4 = {}
    for w in watch or []:
        acct = str(w.get("account_id") or "")
        if acct:
            by_last4[acct[-4:]] = w
    out = []
    for t in (setup or {}).get("testers") or []:
        w = by_last4.get(str(t.get("account", ""))[-4:])
        saves = (w or {}).get("saves") or {}
        has_capture = None if w is None else bool(saves.get("last_capture_any"))
        out.append({
            "key": t["key"], "signed_up_at": t.get("signedUpAt"),
            "vault": None, "vault_provider": None,
            "whatsapp": t.get("step") == "linked", "whatsapp_text": t.get("text"),
            "our_bug": bool(t.get("ourBug")) and t.get("step") != "linked",
            # no note can be sent over WhatsApp before it is linked; once linked, the notes are not readable here
            "message": None if t.get("step") == "linked" else False, "memory": has_capture,
            "notes_24h": None, "saves_24h": None,
            "last_seen_at": None, "seen_record_since": None, "_since": None,
        })
    return out


# ------------------------------------------------------------------ the model (pure, tested)

def build(rows, counts, now, source):
    """rows: one dict per tester (see rows_from_*). Returns the picture's JSON."""
    testers = []
    for r in rows:
        seen = parse_time(r.get("last_seen_at"))
        since = r.get("_since")
        if seen:
            logged_in = (now - seen) <= DAY
        elif source == "progress" and since is not None and (now - since) >= DAY:
            logged_in = False  # the record has run for a full day and this tester is not in it
        else:
            logged_in = None  # not known yet: the record is younger than a day, or not readable
        steps = {"vault": r.get("vault"), "whatsapp": r.get("whatsapp"), "message": r.get("message"), "memory": r.get("memory")}
        stuck = next((s for s, ok in steps.items() if ok is False), None)
        unknown = [s for s, ok in steps.items() if ok is None]
        fully = all(ok is True for ok in steps.values())
        if fully:
            where, nxt = None, "none: keep watching their use"
        elif stuck:
            where = next(w for i, _, w in STEPS if i == stuck)
            nxt = NEXT_OUR_BUG if (stuck == "whatsapp" and r.get("our_bug")) else NEXT[stuck]
        else:
            where, nxt = "a step cannot be read yet: " + ", ".join(unknown), "read it once the new release is live"
        testers.append({
            "tester": "…" + str(r["key"])[-4:], "signed_up_at": r.get("signed_up_at"),
            "logged_in_24h": logged_in, "last_seen_at": r.get("last_seen_at"),
            "steps": steps, "fully_set_up": fully,
            "stuck_at": stuck, "stuck_text": where, "detail": r.get("whatsapp_text") if stuck == "whatsapp" else None, "owner": None if fully else OWNER, "next": nxt,
            "our_bug": bool(r.get("our_bug")),
            "notes_24h": r.get("notes_24h"), "saves_24h": r.get("saves_24h"),
        })
    # stuck testers first, then by sign-up
    testers.sort(key=lambda t: (t["fully_set_up"], t["signed_up_at"] or ""))
    n = len(testers)
    fully_n = sum(1 for t in testers if t["fully_set_up"])
    seen_n = sum(1 for t in testers if t["logged_in_24h"] is True)
    seen_known = all(t["logged_in_24h"] is not None for t in testers)
    stuck_by = {}
    for t in testers:
        if t["stuck_at"]:
            stuck_by[t["stuck_at"]] = stuck_by.get(t["stuck_at"], 0) + 1
    unread = sorted({s for t in testers for s, ok in t["steps"].items() if ok is None})
    c = counts or {}
    return {
        "schema": "zenod-tester-picture/v1", "row": ROW, "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "day_mexico_city": now.astimezone(MX).strftime("%Y-%m-%d"), "source": source,
        "applied": c.get("applications"), "signed_up": n, "logged_in_24h": seen_n if seen_known else None,
        "fully_set_up": fully_n,
        "step_counts": {i: sum(1 for t in testers if t["steps"][i] is True) for i, _, _ in STEPS},
        "notes_24h": sum(t["notes_24h"] or 0 for t in testers) if source == "progress" else None,
        "saves_24h": sum(t["saves_24h"] or 0 for t in testers) if source == "progress" else None,
        "stuck_by_step": stuck_by, "unread_steps": unread, "owner": OWNER,
        "punchline": punchline(n, fully_n, stuck_by, unread, c.get("applications")),
        "caveat": (f"{', '.join(unread)} cannot be read from production until the next release"
                   if unread else None),
        "testers": testers,
    }


def punchline(n, fully, stuck_by, unread, applied):
    if n == 0:
        who = f"{applied} applied, " if applied else ""
        return f"No tester has signed up yet: {who}0 fully set up"
    names = {"vault": "the vault", "whatsapp": "WhatsApp", "message": "their first note", "memory": "their first memory"}
    plural = "tester" if n == 1 else "testers"
    head = f"{n} {plural}, {fully} fully set up"
    if fully == n:
        return head + ": all four steps done"
    parts = []
    for step, count in stuck_by.items():
        label = names[step]
        if len(stuck_by) == 1 and count == n:
            parts.append(("both" if count == 2 else "all" if count > 2 else "") + (" " if count > 1 else "") + f"stuck at {label}")
        else:
            parts.append(f"{count} at {label}")
    return head + ": " + ", ".join(p.strip() for p in parts)


# ------------------------------------------------------------------ the picture

def load_house():
    spec = importlib.util.spec_from_file_location("house_diagram", HOUSE_DIAGRAM)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


TICK = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="{c}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
CROSS = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="{c}" stroke-width="3.2" stroke-linecap="round"/></svg>'
UNKNOWN = '<span class="unk">?</span>'


def short(text, n):
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def render_html(pic, house):
    s = house.STYLES["paper"]
    faces = "".join(house.font_face(f, w, s["font_files"]) for f, w in {(s["display"][0], s["display"][1]), (s["body"][0], s["body"][1]), (s["text"][0], s["text"][1])})
    serif, sans = s["display"][0], s["text"][0]
    ok, bad = s["tones"]["accent"][1], "#8a4b1c"

    def cell(v):
        return TICK.format(c=ok) if v is True else CROSS.format(c=bad) if v is False else UNKNOWN

    def seen(t):
        v = t["logged_in_24h"]
        return cell(v)

    max_rows = 6
    shown = pic["testers"][:max_rows]
    more = len(pic["testers"]) - len(shown)
    head = "".join(f"<th>{html.escape(t)}</th>" for _, t, _ in STEPS)
    body = ""
    for t in shown:
        steps = "".join(f"<td>{cell(t['steps'][i])}</td>" for i, _, _ in STEPS)
        nxt = ("Fully set up" if t["fully_set_up"] else html.escape(short(t["stuck_text"] or "", 62)))
        who = "" if t["fully_set_up"] else f'<div class="own">{html.escape(t["owner"])}: {html.escape(short(t["next"], 74))}</div>'
        body += f'<tr><td class="who">{html.escape(t["tester"])}</td><td>{seen(t)}</td>{steps}<td class="stk"><b>{nxt}</b>{who}</td></tr>'
    if more > 0:
        body += f'<tr><td class="who" colspan="8">+{more} more in the JSON</td></tr>'
    if not shown:
        body += '<tr><td colspan="8" class="who">No tester has signed up yet</td></tr>'
    def count(v):
        return "?" if v is None else str(v)
    tiles = [
        ("Signed up", count(pic["signed_up"]), f'{pic["applied"]} applied' if pic.get("applied") is not None else ""),
        ("Logged in, 24 h", count(pic["logged_in_24h"]), "last sign-in record"),
        ("Fully set up", f'{pic["fully_set_up"]} of {pic["signed_up"]}', "all four steps"),
        ("Last 24 h", "?" if pic["notes_24h"] is None else f'{pic["notes_24h"]} notes, {pic["saves_24h"]} saved', "WhatsApp notes, memories saved"),
    ]
    tile_html = "".join(f'<div class="tile"><div class="tl">{a}</div><div class="tv">{html.escape(b)}</div><div class="ts">{html.escape(c)}</div></div>' for a, b, c in tiles)
    day = dt.datetime.strptime(pic["day_mexico_city"], "%Y-%m-%d").strftime("%a %-d %b")
    caveat = f' <b>Not readable yet: {html.escape(", ".join(pic["unread_steps"]))}.</b>' if pic.get("unread_steps") else ""
    css = f"""{faces}
*{{box-sizing:border-box;margin:0}}
body{{width:1600px;height:900px;background:{s['bg']};color:{s['ink']};font-family:'{sans}',system-ui,sans-serif;overflow:hidden}}
.c{{padding:56px 80px 0}}
.k{{font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:{s['muted']};font-weight:600}}
h1{{font-family:'{serif}',Georgia,serif;font-weight:{s['display'][1]};font-size:58px;letter-spacing:-.015em;line-height:1.08;margin:12px 0 26px;max-width:1380px}}
.tiles{{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-bottom:26px}}
.tile{{border:1.6px solid {s['ink']};border-radius:6px;padding:14px 20px;background:{s['tones']['default'][0]}}}
.tile:nth-child(3){{background:{s['tones']['accent'][0]};border-color:{ok}}}
.tl{{font-size:18px;color:{s['muted']};font-weight:600}}.tv{{font-family:'{serif}',Georgia,serif;font-size:40px;margin:2px 0}}.ts{{font-size:16px;color:{s['muted']}}}
table{{width:100%;border-collapse:collapse;font-size:20px}}
th{{text-align:center;font-weight:600;font-size:17px;color:{s['muted']};padding:6px 6px 10px;border-bottom:1.6px solid {s['ink']}}}
th:first-child,th:last-child{{text-align:left}}
td{{text-align:center;padding:16px 6px;border-bottom:1px solid {s['tones']['muted'][1]};vertical-align:middle}}
td.who{{text-align:left;font-weight:600;white-space:nowrap}}td.stk{{text-align:left;width:520px;line-height:1.25}}
.own{{font-size:16px;color:{s['muted']};margin-top:3px;font-weight:400}}
.unk{{font-size:26px;color:{s['muted']};font-weight:600}}
.f{{position:absolute;left:80px;right:80px;bottom:30px;font-size:16px;color:{s['muted']};display:flex;justify-content:space-between;gap:40px}}.f b{{color:#8a4b1c}}"""
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>{html.escape(pic["punchline"])}</title><style>{css}</style></head><body>'
            f'<div class="c"><div class="k">Zenod testers · {day}</div><h1>{html.escape(pic["punchline"])}</h1>'
            f'<div class="tiles">{tile_html}</div>'
            f'<table><tr><th>Tester</th><th>Logged in</th>{head}<th>Stuck at, who moves them, what next</th></tr>{body}</table></div>'
            f'<div class="f"><span>Read {pic["generated_at"][:16].replace("T", " ")}Z from production. Testers by the last 4 of their id: no email, number or note text.{caveat}</span><span>zenod · E7-S17</span></div>'
            "</body></html>")


def render_png(pic, png: pathlib.Path):
    house = load_house()
    page = png.with_suffix(".html")
    page.write_text(render_html(pic, house), encoding="utf-8")
    subprocess.run([house.chrome(), "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--window-size=1600,900",
                    "--virtual-time-budget=4000", "--force-device-scale-factor=1", f"--screenshot={png}", f"file://{page}"],
                   check=True, capture_output=True, timeout=90)
    page.unlink(missing_ok=True)


def write(pic, out: pathlib.Path, png=render_png):
    day = out / pic["day_mexico_city"]
    day.mkdir(parents=True, exist_ok=True)
    jpath, ppath = day / "tester-picture.json", day / "tester-picture.png"
    png_ok = True
    try:
        png(pic, ppath)
    except Exception as e:  # the facts still go out; the picture's absence is said in the JSON
        png_ok = False
        print(f"picture not drawn: {str(e)[:200]}", file=sys.stderr)
    pic = {**pic, "png": str(out / "latest.png") if png_ok else None, "png_day": str(ppath) if png_ok else None}
    jpath.write_text(json.dumps(pic, indent=2) + "\n", encoding="utf-8")
    shutil.copyfile(jpath, out / "latest.json")
    if png_ok:
        shutil.copyfile(ppath, out / "latest.png")
    return jpath, ppath if png_ok else None


def strip_private(pic):
    return {**pic, "testers": [{k: v for k, v in t.items() if not k.startswith("_")} for t in pic["testers"]]}


def run(dry_run=False, now=None, sources=None, png=render_png):
    now = now or dt.datetime.now(dt.timezone.utc)
    progress, setup, watch, counts = (sources or read_sources)()
    if progress is not None:
        rows, source = rows_from_progress(progress), "progress"
    elif setup is not None:
        rows, source = rows_from_fallback(setup, watch), "fallback"
    else:
        print("could not read production's testers (no progress and no whatsapp-setup)", file=sys.stderr)
        return 2
    pic = strip_private(build(rows, counts, now, source))
    if dry_run:
        print(pic["punchline"])
        print(json.dumps(pic, indent=2))
        return 0
    jpath, ppath = write(pic, OUT, png)
    print(pic["punchline"])
    print(f"{jpath}\n{ppath or 'no picture'}")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    return run(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
