#!/usr/bin/env python3
"""Tester voice feedback links (EPIC-7 E7-S9): every Zenod tester gets their own link, and feedback_recorded stays true.

Jordi (vn_27afac4e, 8 Nov): "that's our way of getting feedback from customers, that we can send a link and this link
will allow them to provide voice notes that ... link back to a structured data of feedback ... I am so worried that all
this feedback is going to get lost."

The team console (voice-feedback service) runs on VPS3 only, so production never calls it. One tick (a vps3 user timer,
every 15 minutes, the zenod-tester-stuck pattern):
  1. read production's GET /api/ops/testers/feedback-links on VPS1 (the ops token never leaves it): every tester
     account that finished the free checkout, our own test accounts flagged, with the link it already holds;
  2. a tester with no link gets one on the console (POST /api/feedback/links, product Zenod, campaign testers). One
     link per person, kept for good: the local ledger (by email) is written before anything else, so a person with two
     accounts, or a tick that failed half way, never gets a second link;
  3. each link's filed notes are counted from the console (GET /api/feedback, notes in state `filed`);
  4. every link goes back with its count (POST the same route); the app shows it as "Tell us what you think" and the
     public counts read `feedback_recorded` from it.
It never messages a tester.

  python3 scripts/tester-feedback/sync.py            # one tick
  python3 scripts/tester-feedback/sync.py --dry-run  # print what would change, write nothing
Way back: systemctl --user disable --now zenod-tester-feedback.timer (links already shown stay; turn one off on the
console's Voice feedback page).
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tester-thanks"))
from send import console, ops  # noqa: E402  (the same VPS1 ops call and console client as the thank-you timer)

ROW = "E7-S9"
PRODUCT = "Zenod"
CAMPAIGN = "testers"
STATE = pathlib.Path(os.environ.get("TESTER_FEEDBACK_STATE", "~/.local/state/zenod-tester-feedback")).expanduser()


def read_ledger() -> dict:
    try:
        return json.loads((STATE / "links.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_ledger(ledger: dict) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    tmp = STATE / "links.tmp"
    tmp.write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")
    tmp.replace(STATE / "links.json")


def person(t: dict) -> str:
    return (t.get("email") or t["accountId"]).lower()


def tick(dry_run: bool = False, ops_call=ops, console_call=console, log=print) -> int:
    code, data = ops_call("GET", "/api/ops/testers/feedback-links")
    if code != 200:
        log(f"could not read the testers: {code} {str(data)[:200]}")
        return 2
    testers = data.get("testers") or []
    ledger = read_ledger()
    # links production already holds count as made (a ledger lost on vps3 never makes a second link)
    for t in testers:
        if t.get("link") and person(t) not in ledger:
            ledger[person(t)] = {"linkId": t["link"]["linkId"], "url": t["link"]["url"]}
    made = 0
    for t in testers:
        if person(t) in ledger:
            continue
        if dry_run:
            log(f"would make a link for {t['who']}")
            continue
        c, link = console_call("POST", "/api/feedback/links", {"who": t["who"], "product": PRODUCT, "campaign": CAMPAIGN})
        if c not in (200, 201) or not link.get("id") or not str(link.get("url", "")).startswith("https://"):
            log(f"console could not make a link for {t['accountId'][-4:]}: {c} {str(link)[:200]}")
            continue
        ledger[person(t)] = {"linkId": link["id"], "url": link["url"]}
        write_ledger(ledger)
        made += 1
    if dry_run:
        return 0
    write_ledger(ledger)
    c, feedback = console_call("GET", "/api/feedback")
    if c != 200:
        log(f"could not read the console's notes: {c}; links handed back without new counts")
        feedback = None
    filed: dict[str, int] = {}
    for n in (feedback or {}).get("notes") or []:
        if n.get("state") == "filed":
            filed[n.get("linkId")] = filed.get(n.get("linkId"), 0) + 1
    links = []
    for t in testers:
        mine = ledger.get(person(t))
        if not mine:
            continue
        held = (t.get("link") or {}).get("notes", 0) if (t.get("link") or {}).get("linkId") == mine["linkId"] else 0
        # a filed note is never unfiled, and the console lists only its newest 100: the count never goes down
        notes = max(filed.get(mine["linkId"], 0), held)
        links.append({"accountId": t["accountId"], "linkId": mine["linkId"], "url": mine["url"], "notes": notes})
    if not links:
        return 0
    c, out = ops_call("POST", "/api/ops/testers/feedback-links", {"links": links})
    if c != 200:
        log(f"production refused the links: {c} {str(out)[:200]}")
        return 1
    with_notes = sum(1 for link in links if link["notes"] > 0)
    log(f"{ROW}: {len(links)} tester link(s) handed to production ({made} new, {with_notes} with filed notes); refused {out.get('refused')}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="print what would change, write nothing")
    return tick(dry_run=parser.parse_args(argv).dry_run)


if __name__ == "__main__":
    sys.exit(main())
