#!/usr/bin/env python3
"""Tester thank-you mail sender (EPIC-26 E26-S28 iteration 3), the next-day WhatsApp email (E26-S32) and the sign-up welcome (E26-S33).

The Delivery Manager decided on 2026-11-15 (spine Decisions, E26-A16 withdrawn): the thank-you email a tester gets
when they link WhatsApp goes from Jordi's own mailbox through the console's team Gmail connection (MCP `team-gmail`,
tool `gmail_send`: capped per persona per day, every send logged with its run), not through Zenod's own Google sender,
which needs his Allow. Zenod's own sender stays; if he ever presses Connect on cloud.zenod.dev/admin/mail it sends
whatever is still queued, and this script finds nothing left.

One tick (a vps3 user timer, every 15 minutes):
  1. read production's queue: GET /api/ops/testers/onboarding/mail-queue, run on VPS1 so the ops token never leaves it;
  2. nothing queued: exit, no console run opened;
  3. else open one short console run on the Zenod Delivery Manager's assignment (the pattern of agent_team
     scripts/daily_report.py: the persona Jordi switched Send on for), send each mail with gmail_send, mark it sent
     (POST .../mail-sent {id, via, messageId}) and close the run.

Never twice: a mail gmail_send accepted is written to a local ledger before it is marked, so a failed mark is
retried next tick without sending again; Zenod lists one mail per address and closes the rest on the mark.
A refused send (cap, switch) stops the tick: nothing is retried in a loop.

E7-S40 (Jordi, vn_febcc8c2, 25 Nov: "We've had problems with these email addresses for a long time ... when they
registered, we didn't get their names"): every queued mail carries Zenod's `facts` (where the address came from, the
greeted name and where it came from, and what is missing or unsure), and gmail_send gets them (agent_team 72a1da30 holds
outside mail without them). A mail with no facts, or with anything missing or unsure, is held: not sent, not marked, and
the tick says what is missing. A tester on the hold list (state dir `hold.json`: {"accounts": [account id ends],
"reason": "..."}) gets nothing while listed.

  python3 scripts/tester-thanks/send.py            # one tick
  python3 scripts/tester-thanks/send.py --dry-run  # list what would go (addresses masked), send nothing
Way back: systemctl --user disable --now zenod-tester-thanks.timer
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROW = "E26-S28/E26-S32/E26-S33/E7-S28/E7-S40"
CONSOLE = os.environ.get("CONSOLE_URL", "http://127.0.0.1:18750").rstrip("/")
# The Zenod milestone's Delivery Manager (persona with Send switched on, console Services page).
ASSIGNMENT = os.environ.get("ZENOD_DM_ASSIGNMENT", "as_f4fd49bd-5c61-4b8f-a5c5-397a238b1617")
BASE = os.environ.get("ZENOD_BASE", "https://cloud.zenod.dev").rstrip("/")
OPS_HOST = os.environ.get("ZENOD_OPS_HOST", "hetzner_vps_1")
TOKEN_FILE = os.environ.get("ZENOD_OPS_TOKEN_FILE", "~/.config/zenod/tester-ops-token")
STATE = pathlib.Path(os.environ.get("TESTER_THANKS_STATE", "~/.local/state/zenod-tester-thanks")).expanduser()
VIA = "team-gmail"
MESSAGE_ID = re.compile(r"Message-ID (<[^>\s]+>)")


def mask(address: str) -> str:
    user, _, domain = address.partition("@")
    return f"{user[:2]}…@{domain}"


def ops(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    """Call a production ops route from VPS1, where the token file lives; the token is never printed or copied."""
    data = json.dumps(body) if body is not None else ""
    remote = (
        f'f={TOKEN_FILE}; curl -sS -m 30 -w "\\n%{{http_code}}" -X {method} '
        f'-H "Authorization: Bearer $(cat $f)" -H "content-type: application/json" '
        + ("--data-binary @- " if body is not None else "")
        + f"{BASE}{path}"
    )
    run = subprocess.run(["ssh", "-o", "BatchMode=yes", OPS_HOST, remote], input=data, capture_output=True, text=True, timeout=90)
    if run.returncode != 0:
        return 0, {"error": f"ssh {run.returncode}: {run.stderr.strip()[:200]}"}
    text, _, code = run.stdout.rpartition("\n")
    try:
        return int(code), json.loads(text or "{}")
    except ValueError:
        return int(code) if code.isdigit() else 0, {"error": "not json"}


def console(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(CONSOLE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except ValueError:
            return e.code, {"error": f"http {e.code}"}


def send_facts(mail: dict) -> dict:
    """gmail_send's facts from the account record Zenod read: address_from, and name/name_from when the mail greets one."""
    facts = mail.get("facts") or {}
    out = {"address_from": str(facts.get("address_from") or "")}
    if facts.get("name"):
        out["name"] = str(facts["name"])
        out["name_from"] = str(facts.get("name_from") or "")
    return out


def why_held(mail: dict, hold: dict) -> str:
    """Why this mail may not go now, in plain words; empty when it may. Never guess an address or a name."""
    for end in hold.get("accounts") or []:
        if end and str(mail.get("id", "")).endswith(str(end)):
            return f"on hold: {hold.get('reason') or 'listed in hold.json'}"
    facts = mail.get("facts")
    if not isinstance(facts, dict):
        return "missing: Zenod sent no facts for this mail (where the address and the name came from)"
    missing = [str(x) for x in facts.get("missing") or []]
    if len(str(facts.get("address_from") or "").strip()) < 3:
        missing.insert(0, "address: where it came from (facts.address_from)")
    if facts.get("name") and len(str(facts.get("name_from") or "").strip()) < 3:
        missing.append(f"name: where \"{facts['name']}\" came from (facts.name_from)")
    return ("missing: " + "; ".join(missing)) if missing else ""


def read_hold() -> dict:
    try:
        hold = json.loads((STATE / "hold.json").read_text(encoding="utf-8"))
        return hold if isinstance(hold, dict) else {}
    except (OSError, ValueError):
        return {}


def gmail_send(run: str, mail: dict, call=console) -> tuple[bool, str]:
    code, out = call("POST", "/api/mcp/gmail", {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
        "name": "gmail_send", "arguments": {"run_id": run, "to": mail["to"], "subject": mail["subject"], "body": mail["text"],
                                            "facts": send_facts(mail)}}})
    res = out.get("result") or {}
    text = " ".join(c.get("text", "") for c in res.get("content", []) if isinstance(c, dict)) or json.dumps(out)[:300]
    return code == 200 and not res.get("isError") and "error" not in out, text


def open_run(call=console) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    code, out = call("POST", "/api/runs", {"assignmentId": ASSIGNMENT, "host": "vps3",
                                           "summary": f"{ROW} tester mail (timer)",
                                           "clientRequestId": f"tester-thanks-{now.strftime('%Y%m%dT%H%M%S')}"})
    if code not in (200, 201) or not out.get("id"):
        raise SystemExit(f"could not open a console run: {code} {str(out)[:200]}")
    return out["id"]


def close_run(run: str, ok: bool, summary: str, call=console) -> None:
    call("PATCH", f"/api/runs/{run}", {"outcome": "progressed" if ok else "failed", "summary": summary[:900],
                                       "endedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})


def ledger_path() -> pathlib.Path:
    return STATE / "sent.json"


def read_ledger() -> dict:
    try:
        return json.loads(ledger_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_ledger(ledger: dict) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    tmp = ledger_path().with_suffix(".tmp")
    tmp.write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(ledger_path())


# Each queue: (label, queue route, mark route, absent ok). E26-S32: the next-day WhatsApp email (Jordi's yes on E26-A17)
# rides the same tick, run and ledger; a production without its route (before the promote) is skipped quietly.
# E26-S33: the sign-up welcome (zenod-social's EPIC-6-A4, Jordi approved 15 Nov) is listed first, so within one tick a new
# tester's first email from us is the welcome; the thank-you and the next-day email keep their own rules.
QUEUES = (
    ("signup-welcome", "/api/ops/testers/signup-welcome/queue", "/api/ops/testers/signup-welcome/sent", True),
    ("thank-you", "/api/ops/testers/onboarding/mail-queue", "/api/ops/testers/onboarding/mail-sent", False),
    ("whatsapp-nudge", "/api/ops/testers/whatsapp-nudge/queue", "/api/ops/testers/whatsapp-nudge/sent", True),
    # E7-S28 (Jordi's approval on E7-A36): his own setup email 48 hours after a sign-up with nothing done, once per tester.
    ("setup-email", "/api/ops/testers/setup-email/queue", "/api/ops/testers/setup-email/sent", True),
)


def tick(dry_run: bool = False, ops_call=ops, console_call=console, log=print, hold: dict | None = None) -> int:
    due: list[tuple[str, dict]] = []
    for label, queue_path, mark_path, optional in QUEUES:
        code, queue = ops_call("GET", queue_path)
        if code != 200 and optional:
            # E26-S32: before the promote production has no such route (it answers 401 or 404); a failing optional
            # queue never holds the thank-you back.
            log(f"skipped the {label} queue: {code}")
            continue
        if code != 200:
            log(f"could not read the {label} queue: {code} {str(queue)[:200]}")
            return 2
        due += [(mark_path, m) for m in queue.get("mails") or []]
    if not due:
        return 0
    ledger = read_ledger()
    hold = read_hold() if hold is None else hold
    held: list[str] = []
    ready: list[tuple[str, dict]] = []
    for mark_path, m in due:
        why = "" if m["id"] in ledger else why_held(m, hold)
        if why:
            held.append(f"{m['id']} to {mask(m['to'])}: {why}")
        else:
            ready.append((mark_path, m))
    for line in held:
        log(f"held, not sent (E7-S40): {line}")
    due = ready
    if dry_run:
        for _, m in due:
            log(f"would send {m['id']} to {mask(m['to'])}: {m['subject']}{' (already sent, mark only)' if m['id'] in ledger else ''}")
        return 0
    if not due:
        return 0
    run = None
    sent = marked = 0
    problem = ""
    for mark_path, m in due:
        entry = ledger.get(m["id"])
        if not entry:
            run = run or open_run(console_call)
            ok, answer = gmail_send(run, m, console_call)
            if not ok:
                problem = f"send refused or failed for {m['id']}: {answer[:200]}"
                break
            found = MESSAGE_ID.search(answer)
            entry = {"to": m["to"], "sentAt": dt.datetime.now(dt.timezone.utc).isoformat(), "messageId": found.group(1) if found else "", "run": run}
            ledger[m["id"]] = entry
            write_ledger(ledger)
            sent += 1
        mcode, mout = ops_call("POST", mark_path, {"id": m["id"], "to": m["to"], "via": VIA, "messageId": entry.get("messageId") or None})
        if mcode == 200:
            marked += 1
        else:
            problem = f"mark failed for {m['id']}: {mcode} {str(mout)[:200]} (retried next tick, not resent)"
    summary = (f"{ROW}: tester mail, {sent} sent through team-gmail, {marked} marked sent" + (f"; {problem}" if problem else "")
               + (f"; {len(held)} held (E7-S40): " + " | ".join(held) if held else ""))
    log(summary)
    if run:
        close_run(run, not problem, summary, console_call)
    return 1 if problem else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="list what would go, send nothing")
    args = parser.parse_args(argv)
    return tick(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
