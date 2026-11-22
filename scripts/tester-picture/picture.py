#!/usr/bin/env python3
"""The daily Zenod tester picture (EPIC-7 E7-S17) and, since E7-S27, Jordi's tester table.

E7-S27 (Jordi, vn_40b9ff8f, 22 Nov): "do we have like a table of testers? ... rows, and each row is a tester, and each
column is like a sign up, Google Drive set up, GitHub set up, one memory created, one voice note sent ... each tester
having a color. Is it green or not green? ... welcome WhatsApp sent, maybe that's another column." The picture below is now
exactly that table: one row per tester (the sign-up date and the last 4 of the account key), seven columns, each cell green
or grey, one headline, and one line on whether we hold their phone numbers. The same facts also go out as a calm page on
the page host (see PAGE_DIR) rebuilt on every run.

E7-S27 iteration 2 (Jordi, vn_c2e56f5c, 22 Nov): "can we just have a fucking email, bro? ... I cannot even see the tester."
Each tester is now shown by their sign-in email (he owns these testers' data), on the tailnet page, in the picture and in
the JSON (`email`, and `label` = the email) that agent_team's Testers tracker is fed from. The page stays tailnet-only.
Still never a phone number, code or note text. The email is read from `tester-watch` on VPS1 (the progress route keeps it
back), joined by the last 8 of the account key; a tester whose email cannot be read keeps the old date and last-4 label.

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
moving them and what happens next, and the last 24 h of use. A tester is their email (E7-S27 iteration 2), with the last 4
characters of their account id kept as `tester`. Never a phone number, code or note text.

Sources, read only: GET /api/ops/testers/progress (this release), else GET /api/ops/testers/whatsapp-setup with
`tester-watch --json` (memories and, since iteration 2, each tester's email; the steps those two cannot see are shown as "?", never guessed), and the public counts.

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

ROW = "E7-S27"
OWNER = "Zenod Delivery Manager"
MX = ZoneInfo("America/Mexico_City")
OUT = pathlib.Path(os.environ.get("TESTER_PICTURE_OUT", "~/.local/state/zenod-tester-picture")).expanduser()
COUNTS_URL = os.environ.get("ZENOD_PUBLIC_COUNTS", "https://cloud.zenod.dev/api/public/counts")
OPS_HOST = os.environ.get("TESTER_PICTURE_OPS_HOST", "hetzner_vps_1")
HOUSE_DIAGRAM = pathlib.Path(os.environ.get(
    "HOUSE_DIAGRAM", "~/github/agent_team/skills/house-diagram-style/scripts/house_diagram.py")).expanduser()
DAY = dt.timedelta(hours=24)
# E7-S27: the page host folder (served by zenod-tester-table-page.service) and the address Jordi opens.
PAGE_DIR = pathlib.Path(os.environ.get("TESTER_TABLE_PAGE_DIR", "/var/lib/vps3-scratch/t3agent/pages/e7-s27"))
PAGE_URL = os.environ.get("TESTER_TABLE_PAGE_URL", "http://vps3.taild81fbb.ts.net:9008/")

# E7-S27: Jordi's seven columns, in his order. A cell is green or grey, nothing else.
COLUMNS = [
    ("signup", "Signed up"),
    ("drive", "Google Drive set up"),
    ("github", "GitHub set up"),
    ("whatsapp", "WhatsApp code confirmed"),
    ("memory", "One memory saved"),
    ("voice", "One voice note sent"),
    ("welcome", "Welcome WhatsApp sent"),
]

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
    setup = None
    if code != 200:
        progress = None
        c2, setup = ops_call("GET", "/api/ops/testers/whatsapp-setup")
        setup = setup if c2 == 200 else None
    # tester-watch on VPS1 holds each tester's email (E7-S27 iteration 2) and, for the fallback, the memories; never a reason to skip the picture
    try:
        r = run(["ssh", "-o", "BatchMode=yes", OPS_HOST, "tester-watch --json --no-stripe"],
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


def emails_by_key(watch):
    """The last 8 of each account id to that account's sign-in email, from tester-watch rows; a row without an email is left out."""
    out = {}
    for w in watch or []:
        acct, email = str(w.get("account_id") or ""), str(w.get("email") or "").strip().lower()
        if acct and "@" in email:
            out[acct[-8:]] = email
    return out


def rows_from_progress(progress, emails=None):
    since = parse_time(progress.get("lastSeenSince"))
    emails = emails or {}
    out = []
    for t in progress.get("testers") or []:
        out.append({
            "key": t["key"], "signed_up_at": t.get("signedUpAt"), "email": emails.get(str(t["key"])[-8:]),
            "vault": bool(t["vault"]["set"]), "vault_provider": t["vault"].get("provider"),
            "whatsapp": bool(t["whatsapp"]["linked"]), "whatsapp_text": t["whatsapp"].get("text"),
            "our_bug": bool(t["whatsapp"].get("ourBug")) and not t["whatsapp"]["linked"],
            "message": t.get("whatsappNotes", 0) > 0, "memory": t.get("memoriesSaved", 0) > 0,
            "voice": (t["voiceNotes"] > 0) if "voiceNotes" in t else None,
            "welcome": (bool(t["welcomeSentAt"])) if "welcomeSentAt" in t else None,
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
            "key": t["key"], "signed_up_at": t.get("signedUpAt"), "email": str((w or {}).get("email") or "").strip().lower() or None,
            "vault": None, "vault_provider": None,
            "whatsapp": t.get("step") == "linked", "whatsapp_text": t.get("text"),
            "our_bug": bool(t.get("ourBug")) and t.get("step") != "linked",
            # no note can be sent over WhatsApp before it is linked; once linked, the notes are not readable here
            "message": None if t.get("step") == "linked" else False, "memory": has_capture,
            "voice": None, "welcome": None,
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
        cells, unread_cells = table_cells(r)
        testers.append({
            "tester": "…" + str(r["key"])[-4:], "signed_up_at": r.get("signed_up_at"),
            "email": r.get("email"), "label": row_label(r), "since": signed_up_text(r), "cells": cells, "unread_cells": unread_cells,
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
    unread_cells = [cid for cid, _ in COLUMNS if any(cid in t["unread_cells"] for t in testers)]
    column_counts = {cid: sum(1 for t in testers if t["cells"][cid]) for cid, _ in COLUMNS}
    c = counts or {}
    return {
        "schema": "zenod-tester-picture/v2", "row": ROW, "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "day_mexico_city": now.astimezone(MX).strftime("%Y-%m-%d"), "source": source,
        "applied": c.get("applications"), "signed_up": n, "logged_in_24h": seen_n if seen_known else None,
        "fully_set_up": fully_n,
        "step_counts": {i: sum(1 for t in testers if t["steps"][i] is True) for i, _, _ in STEPS},
        "notes_24h": sum(t["notes_24h"] or 0 for t in testers) if source == "progress" else None,
        "saves_24h": sum(t["saves_24h"] or 0 for t in testers) if source == "progress" else None,
        "stuck_by_step": stuck_by, "unread_steps": unread, "owner": OWNER,
        "columns": [{"id": cid, "title": title} for cid, title in COLUMNS],
        "column_counts": column_counts, "unread_cells": unread_cells,
        "punchline": headline(n, column_counts, c.get("applications")),
        "phone_line": phone_line(n, column_counts["whatsapp"]), "key_line": KEY_LINE,
        "page_url": PAGE_URL,
        "caveat": (f"{', '.join(label for cid, label in COLUMNS if cid in unread_cells)} cannot be read from production "
                   "until its next release, so those cells show grey" if unread_cells else None),
        "testers": testers,
    }


def table_cells(r):
    """Jordi's seven cells for one tester: True is green, anything else is grey. Returns (cells, ids not readable yet)."""
    vault, provider = r.get("vault"), r.get("vault_provider")
    drive = None if vault is None else bool(vault and provider == "google_drive")
    github = None if vault is None else bool(vault and provider in ("github", "legacy"))
    raw = {"signup": True, "drive": drive, "github": github, "whatsapp": r.get("whatsapp"), "memory": r.get("memory"),
           "voice": r.get("voice"), "welcome": r.get("welcome")}
    return {k: v is True for k, v in raw.items()}, [k for k, v in raw.items() if v is None]


def signed_up_text(r):
    when = parse_time(r.get("signed_up_at"))
    return "signed up " + when.astimezone(MX).strftime("%-d %b") if when else "sign-up date unknown"


def row_label(r):
    """The tester's email (Jordi, vn_c2e56f5c: "can we just have a fucking email"); only when it cannot be read, the sign-up date and the last 4 of the account key."""
    if r.get("email"):
        return r["email"]
    when = parse_time(r.get("signed_up_at"))
    day = when.astimezone(MX).strftime("%-d %b") if when else "date unknown"
    return f"{day} · …{str(r['key'])[-4:]}"


def headline(n, counts, applied):
    """One line for the table: how many testers, and how many are green in the four columns that matter most."""
    if n == 0:
        who = f"{applied} applied, " if applied else ""
        return f"No tester has signed up yet: {who}nothing to set up"
    vault = counts["drive"] + counts["github"]
    tail = f"{vault} set up a vault, {counts['whatsapp']} linked WhatsApp, {counts['memory']} saved a memory, {counts['voice']} sent a voice note"
    if all(counts[c] == n for c in ("whatsapp", "memory", "voice")) and vault == n:
        return f"{n} {'tester' if n == 1 else 'testers'}, all set up"
    return f"{n} {'tester' if n == 1 else 'testers'}: {tail}"


# E7-S27 (Jordi, vn_40b9ff8f: "we send a code to that phone number ... are we monitoring ... whether this handshake was
# successfully filled in, so the connection is complete?"): what a green cell means for the two steps that need a handshake.
KEY_LINE = ("Green WhatsApp code confirmed means the handshake finished: the tester gave their number, got a code, sent it back from the "
            "phone and Zenod confirmed it. Green Google Drive or GitHub set up means their storage is ready.")


def phone_line(n, linked):
    """His question 'did they give the phone number? can we even see it?', answered in one plain line."""
    if n == 0 or linked == 0:
        return "Phone numbers: none yet, no tester has linked WhatsApp; a linked number sits only in Phylax and this page never shows it."
    return (f"Phone numbers: Phylax holds the number of the {linked} of {n} testers who linked WhatsApp "
            "and this page never shows it; the rest have no number with Phylax.")


# ------------------------------------------------------------------ the picture

def load_house():
    spec = importlib.util.spec_from_file_location("house_diagram", HOUSE_DIAGRAM)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


GREEN, GREY = "#1f4d3a", "#ddd6c6"
TICK = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#f6f2e9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'


def dot(on, label):
    """One cell: a green disc with a tick, or a plain grey disc. Nothing else."""
    return (f'<span class="dot {"on" if on else "off"}" role="img" aria-label="{html.escape(label)}: {"yes" if on else "not yet"}">'
            f'{TICK if on else ""}</span>')


def mask_email(text):
    """ab…@domain: the first two characters of the address, like the tester mails' log lines."""
    user, at, domain = (text or "").partition("@")
    return f"{user[:2]}…@{domain}" if at else text


def table_rows(pic, limit=None, masked=False):
    shown = pic["testers"][:limit] if limit else pic["testers"]
    rows = ""
    for t in shown:
        who = mask_email(t["label"]) if masked and t.get("email") else t["label"]
        cells = "".join(f'<td data-label="{html.escape(title)}">{dot(t["cells"][cid], title)}</td>' for cid, title in COLUMNS)
        rows += (f'<tr><th scope="row" class="who"><span class="em">{html.escape(who)}</span>'
                 f'<small>{html.escape(t.get("since") or "")}</small></th>{cells}</tr>')
    return rows, len(pic["testers"]) - len(shown)


def table_head():
    return "<tr><th>Tester</th>" + "".join(f"<th>{html.escape(title)}</th>" for _, title in COLUMNS) + "</tr>"


def footer_text(pic):
    caveat = f" Grey can also mean not readable yet: {html.escape(', '.join(t for c, t in COLUMNS if c in pic['unread_cells']))}." if pic.get("unread_cells") else ""
    return (f"Read {pic['generated_at'][:16].replace('T', ' ')}Z from production. Each tester is their sign-in email; "
            f"no phone number, code or note text. This page is on the tailnet only.{caveat}")


def render_html(pic, house):
    s = house.STYLES["paper"]
    faces = "".join(house.font_face(f, w, s["font_files"]) for f, w in {(s["display"][0], s["display"][1]), (s["body"][0], s["body"][1]), (s["text"][0], s["text"][1])})
    serif, sans = s["display"][0], s["text"][0]
    rows, more = table_rows(pic, 8)
    if more > 0:
        rows += f'<tr><th scope="row" class="who" colspan="8">+{more} more on the page</th></tr>'
    if not pic["testers"]:
        rows = '<tr><th scope="row" class="who" colspan="8">No tester has signed up yet</th></tr>'
    day = dt.datetime.strptime(pic["day_mexico_city"], "%Y-%m-%d").strftime("%a %-d %b")
    css = f"""{faces}
*{{box-sizing:border-box;margin:0}}
body{{width:1600px;height:900px;background:{s['bg']};color:{s['ink']};font-family:'{sans}',system-ui,sans-serif;overflow:hidden}}
.c{{padding:52px 80px 0}}
.k{{font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:{s['muted']};font-weight:600}}
h1{{font-family:'{serif}',Georgia,serif;font-weight:{s['display'][1]};font-size:46px;letter-spacing:-.01em;line-height:1.12;margin:12px 0 34px;max-width:1440px;text-wrap:balance}}
table{{width:100%;border-collapse:collapse}}
th{{text-align:center;font-weight:600;font-size:18px;color:{s['muted']};padding:6px 6px 12px;border-bottom:1.6px solid {s['ink']};line-height:1.2}}
th:first-child{{text-align:left}}
td,th.who{{padding:17px 6px;border-bottom:1px solid {s['tones']['muted'][1]};vertical-align:middle;text-align:center}}
th.who{{text-align:left;font-weight:600;font-size:22px;color:{s['ink']};white-space:nowrap}}
th.who small{{display:block;margin-top:3px;font-size:15px;font-weight:400;color:{s['muted']}}}
.dot{{display:inline-flex;width:42px;height:42px;border-radius:50%;align-items:center;justify-content:center}}
.dot.on{{background:{GREEN}}}.dot.off{{background:{GREY}}}
.ph{{margin-top:20px;font-size:21px;color:{s['ink']};max-width:1440px;line-height:1.35}}.ph.key{{font-size:18px;color:{s['muted']};margin-top:12px}}
.f{{position:absolute;left:80px;right:80px;bottom:28px;font-size:16px;color:{s['muted']};display:flex;justify-content:space-between;gap:40px}}.f span:last-child{{white-space:nowrap}}"""
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>{html.escape(pic["punchline"])}</title><style>{css}</style></head><body>'
            f'<div class="c"><div class="k">Zenod testers · {day}</div><h1>{html.escape(pic["punchline"])}</h1>'
            f'<table>{table_head()}{rows}</table><p class="ph">{html.escape(pic["phone_line"])}</p><p class="ph key">{html.escape(pic["key_line"])}</p></div>'
            f'<div class="f"><span>{footer_text(pic)}</span><span>zenod · {ROW}</span></div>'
            "</body></html>")


CARD_NOTE = " The emails are shortened on this copy because its screenshot goes into a public repository; the main page shows them in full."

PAGE_CSS = """
.tt-wrap{overflow-x:auto}
.tt{width:100%;border-collapse:collapse;margin:.25rem 0}
.tt th{font:600 .82rem/1.25 var(--sans);color:var(--muted);text-align:center;padding:.4rem .35rem .7rem;border-bottom:1.5px solid var(--ink)}
.tt th:first-child{text-align:left}
.tt td,.tt th.who{padding:.7rem .35rem;border-bottom:1px solid var(--line);text-align:center;vertical-align:middle}
.tt th.who{text-align:left;font:600 1rem/1.3 var(--sans);color:var(--ink);white-space:nowrap}
.tt th.who small{display:block;margin-top:.15rem;font:400 .8rem/1.3 var(--sans);color:var(--muted)}
.dot{display:inline-flex;width:1.7rem;height:1.7rem;border-radius:50%;align-items:center;justify-content:center}
.dot.on{background:var(--accent)}.dot.off{background:var(--stage-2)}
.tt-phone{margin:1.1rem 0 0;font-size:1rem;line-height:1.5}
.tt-foot{margin:1rem 0 0;font-size:.85rem;color:var(--muted)}
@media (max-width:640px){
  .tt thead{display:none}
  .tt,.tt tbody,.tt tr{display:block}
  .tt tr{border-bottom:1px solid var(--line);padding:.9rem 0}
  .tt th.who{display:block;border:0;padding:0 0 .6rem;white-space:normal;overflow-wrap:anywhere}
  .tt td{display:flex;justify-content:space-between;align-items:center;border:0;padding:.25rem 0;text-align:left}
  .tt td::before{content:attr(data-label);font:500 .95rem/1.2 var(--sans);color:var(--ink)}
}
"""


def render_page(pic, png_name="tester-table.png", masked=False):
    """The calm page for the page host, on the shared page shell (agent_team page_shell.py): headline, the table, one phone line.
    masked=True is the card copy (card.html): the emails shortened, because the card check's screenshot is committed to this
    public repo; the full emails are on the main page only."""
    rows, more = table_rows(pic, masked=masked)
    if not pic["testers"]:
        rows = '<tr><th scope="row" class="who" colspan="8">No tester has signed up yet</th></tr>'
    day = pic["day_mexico_city"]
    body = (f'<style>{PAGE_CSS}</style>'
            f'<div class="tt-wrap"><table class="tt"><thead>{table_head()}</thead><tbody>{rows}</tbody></table></div>'
            f'<p class="tt-phone"><b>{html.escape(pic["phone_line"])}</b></p>'
            f'<p class="tt-foot">{html.escape(pic["key_line"])}</p>'
            f'<p class="tt-foot">{footer_text(pic)}{CARD_NOTE if masked else ""} Green means done, grey means not yet. Rebuilt every day at 05:30 Mexico City; '
            f'<a href="{png_name}">today\'s picture</a>.</p>')
    return (f'<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>Zenod tester table</title><link rel="stylesheet" href="/_shell/shell.css"></head>\n<body data-page-shell>\n<main class="ps-page">\n'
            f'<header class="ps-head"><p class="ps-kicker">{ROW} · {day}</p><h1>Zenod tester table</h1></header>\n'
            f'<p class="ps-punch">{html.escape(pic["punchline"])}</p>\n'
            f'<figure class="ps-diagram">{body}</figure>\n'
            f'<p class="ps-foot">{ROW} keeps this page · one shared page shell (E75-S5)</p>\n</main>\n</body></html>\n')


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


def write_page(pic, page_dir: pathlib.Path, png_path=None):
    """The page host folder: index.html on the shared shell, and today's picture beside it. Never raises: the JSON and PNG matter more."""
    try:
        page_dir.mkdir(parents=True, exist_ok=True)
        if png_path and pathlib.Path(png_path).exists():
            shutil.copyfile(png_path, page_dir / "tester-table.png")
        tmp = page_dir / "index.html.tmp"
        tmp.write_text(render_page(pic), encoding="utf-8")
        tmp.replace(page_dir / "index.html")
        (page_dir / "card.html").write_text(render_page(pic, masked=True), encoding="utf-8")
        (page_dir / "tester-table.json").write_text(json.dumps(pic, indent=2) + "\n", encoding="utf-8")
        return page_dir / "index.html"
    except OSError as e:
        print(f"page not written: {str(e)[:200]}", file=sys.stderr)
        return None


def strip_private(pic):
    return {**pic, "testers": [{k: v for k, v in t.items() if not k.startswith("_")} for t in pic["testers"]]}


def run(dry_run=False, now=None, sources=None, png=render_png):
    now = now or dt.datetime.now(dt.timezone.utc)
    progress, setup, watch, counts = (sources or read_sources)()
    if progress is not None:
        rows, source = rows_from_progress(progress, emails_by_key(watch)), "progress"
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
    page = write_page(pic, PAGE_DIR, ppath)
    print(pic["punchline"])
    print(pic["phone_line"])
    print(f"{jpath}\n{ppath or 'no picture'}\n{page or 'no page'}")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    return run(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
