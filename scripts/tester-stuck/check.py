#!/usr/bin/env python3
"""Stuck sign-up check (EPIC-26 E26-S31): a tester signed up over an hour ago and WhatsApp is still not linked.

alpha9 Strategist 2026-11-16 (Jordi vn_5ef65752, 15 Nov: "our single focus right now should be getting testers"): when a
sign-up has not linked WhatsApp after an hour, the team is told and helps them through it the same day; Jordi hears only
if it is our bug.

One tick (a vps3 user timer, every 15 minutes, the zenod-tester-thanks pattern):
  1. read production's GET /api/ops/testers/whatsapp-setup on VPS1 (the ops token never leaves it): every real tester
     account (test accounts left out), masked, with signed-up time and the last WhatsApp step;
  2. a tester signed up > 60 min ago and not linked is stuck; each (tester, step) is reported once (local ledger), a new
     step (say the code request now fails) is reported again;
  3. the report is one line per tester on the Zenod desk: `desk_note.py daily` in this repo's desk/inbox (key
     `tester-stuck`, one note a day, new lines appended), which the console puts in the Zenod Delivery Manager's wake;
  4. a step that is our failure (a 5xx, Phylax unreadable, no channel) also goes to Jordi as one ops alarm through the
     whatsapp-notify skill (`alert`, kind `zenod-tester-stuck-our-bug`, capped 1 per 12 h), on a short console run of
     the Zenod Delivery Manager (the holder).
It never messages a tester.

  python3 scripts/tester-stuck/check.py            # one tick
  python3 scripts/tester-stuck/check.py --dry-run  # print what would be reported, write nothing
Way back: systemctl --user disable --now zenod-tester-stuck.timer
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "tester-thanks"))
from send import console, ops  # noqa: E402  (the same VPS1 ops call and console client as the thank-you timer)

ROW = "E26-S31"
STUCK_AFTER = dt.timedelta(minutes=int(os.environ.get("TESTER_STUCK_MINUTES", "60")))
ASSIGNMENT = os.environ.get("ZENOD_DM_ASSIGNMENT", "as_f4fd49bd-5c61-4b8f-a5c5-397a238b1617")
STATE = pathlib.Path(os.environ.get("TESTER_STUCK_STATE", "~/.local/state/zenod-tester-stuck")).expanduser()
DESK_REPO = pathlib.Path(os.environ.get("TESTER_STUCK_DESK_REPO", str(STATE / "desk"))).expanduser()
AGENT_TEAM = pathlib.Path(os.environ.get("AGENT_TEAM", "~/github/agent_team")).expanduser()
# EPIC-24 M32: production re-confirms every binding every 5 minutes, and a binding read in that moment says "setting up"
# or "unavailable" for a second or two. A tester read that way is read again before it is called our bug.
TRANSIENT = {"channel_setting_up", "channel_unavailable"}
SETTLE_TRIES = int(os.environ.get("TESTER_STUCK_SETTLE_TRIES", "3"))
SETTLE_WAIT = float(os.environ.get("TESTER_STUCK_SETTLE_SECONDS", "20"))
ABOUT = "Testers stuck before WhatsApp: {open} to help today"
INTRO = ("Each signed up over an hour ago and has not linked WhatsApp (E26-S31 check, every 15 min). Help them through it "
         "today: our own email or a call, inside the consent they gave; no automatic message. A line marked our bug "
         "also went to Jordi as an ops alarm.")


def parse_time(value: str | None) -> dt.datetime | None:
    try:
        return dt.datetime.fromisoformat((value or "").replace("Z", "+00:00"))
    except ValueError:
        return None


def stuck(testers: list[dict], now: dt.datetime) -> list[dict]:
    out = []
    for t in testers:
        signed = parse_time(t.get("signedUpAt"))
        if t.get("step") != "linked" and signed and now - signed >= STUCK_AFTER:
            out.append(t)
    return out


def line(t: dict) -> str:
    signed = (t.get("signedUpAt") or "")[:16].replace("T", " ")
    return f"{t['account']}: signed up {signed}Z, WhatsApp not linked; last step: {t['text']}" + (" — our bug" if t.get("ourBug") else "")


def read_ledger() -> dict:
    try:
        return json.loads((STATE / "reported.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_ledger(ledger: dict) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    tmp = STATE / "reported.tmp"
    tmp.write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")
    tmp.replace(STATE / "reported.json")


def desk(items: list[tuple[str, str]], run=subprocess.run) -> bool:
    cmd = [sys.executable, str(AGENT_TEAM / "scripts" / "desk_note.py"), "daily", "--to", str(DESK_REPO), "--from", "zenod",
           "--reply-to", "zenod-ai/zenod", "--key", "tester-stuck", "--about", ABOUT, "--intro", INTRO]
    for key, text in items:
        cmd += ["--item", f"{key}\t{text}"]
    r = run(cmd, capture_output=True, text=True, timeout=180)
    print((r.stdout or "").strip()[-400:] or (r.stderr or "").strip()[-400:])
    return r.returncode == 0


def alarm(text: str, call=console, run=subprocess.run) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    code, out = call("POST", "/api/runs", {"assignmentId": ASSIGNMENT, "host": "vps3", "summary": f"{ROW} stuck tester on our bug (timer)",
                                           "clientRequestId": f"tester-stuck-{now.strftime('%Y%m%dT%H%M%S')}"})
    if code not in (200, 201) or not out.get("id"):
        return f"no console run: {code}"
    r = run([sys.executable, str(AGENT_TEAM / "skills" / "whatsapp-notify" / "notify.py"), "alert", "--run", out["id"],
             "--kind", "zenod-tester-stuck-our-bug", "--text", text], capture_output=True, text=True, timeout=120)
    answer = (r.stdout or r.stderr or "").strip()[:300]
    call("PATCH", f"/api/runs/{out['id']}", {"outcome": "progressed" if r.returncode == 0 else "failed",
                                             "summary": f"{ROW}: ops alarm to Jordi: {text} → {answer}"[:900],
                                             "endedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
    return answer


def settle(data: dict, ops_call, sleep=time.sleep, log=print) -> dict:
    """Read the setup again (up to SETTLE_TRIES times, SETTLE_WAIT apart) while any tester still reads as in a transient
    channel state; a state that stays is real and is returned as read the last time."""
    for _ in range(SETTLE_TRIES):
        if not any(t.get("step") in TRANSIENT for t in data.get("testers") or []):
            break
        sleep(SETTLE_WAIT)
        code, again = ops_call("GET", "/api/ops/testers/whatsapp-setup")
        if code != 200:
            break
        log("a tester read as setting up or unavailable; read again")
        data = again
    return data


def tick(dry_run: bool = False, ops_call=ops, desk_call=desk, alarm_call=alarm, now: dt.datetime | None = None, log=print,
         sleep=time.sleep) -> int:
    now = now or dt.datetime.now(dt.timezone.utc)
    code, data = ops_call("GET", "/api/ops/testers/whatsapp-setup")
    if code != 200:
        log(f"could not read the testers' WhatsApp setup: {code} {str(data)[:200]}")
        return 2
    data = settle(data, ops_call, sleep, log)
    ledger = read_ledger()
    new = [t for t in stuck(data.get("testers") or [], now) if ledger.get(t["key"]) != t["step"]]
    if not new:
        return 0
    if dry_run:
        for t in new:
            log("would report: " + line(t))
        return 0
    if not desk_call([(t["key"], line(t)) for t in new]):
        log("desk note failed; retried next tick")
        return 1
    for t in new:
        ledger[t["key"]] = t["step"]
    write_ledger(ledger)
    ours = [t for t in new if t.get("ourBug")]
    if ours:
        text = f"Zenod: {len(ours)} tester(s) stuck before WhatsApp on our bug ({'; '.join(line(t) for t in ours)}). The team is on it."
        log("alarm: " + alarm_call(text[:700]))
    log(f"{ROW}: reported {len(new)} stuck tester(s), {len(ours)} our bug")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="print what would be reported, write nothing")
    return tick(dry_run=parser.parse_args(argv).dry_run)


if __name__ == "__main__":
    sys.exit(main())
