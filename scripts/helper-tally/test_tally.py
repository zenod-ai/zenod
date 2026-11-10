"""EPIC-14 S30: the tally keeps only fixed fields of the app's content-free lines. Run: python3 -I scripts/helper-tally/test_tally.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tally  # noqa: E402

run = tally.parse_line("[persona] tenant=t1 open-loops schedule done: steps=3 calls=1 tokens=5064/250 usd=0.00091 suggestions=1 findings=1 questions=0")
assert run == {"e": "run", "tenant": "t1", "helper": "open-loops", "trigger": "schedule", "status": "done", "calls": 1,
               "in": 5064, "out": 250, "usd": 0.00091, "suggestions": 1, "findings": 1, "questions": 0}, run
old = tally.parse_line("[persona] tenant=t1 weekly-recap schedule skipped: steps=0 calls=0 tokens=0/0 usd=0.00000")
assert old["uncounted"] == 1 and "suggestions" not in old, old
tap = tally.parse_line("[inbox-tap] tenant=t1 helper=topic-gardener kind=suggestion action=not-now-reason item=abc-1")
assert tap == {"e": "tap", "tenant": "t1", "helper": "topic-gardener", "kind": "suggestion", "action": "not-now-reason", "item": "abc-1"}
roster = tally.parse_line("[persona] tenant=t1 switched-on=open-loops:night:2026-11-11T02:00Z,topic-gardener:days3:2026-11-12T02:00Z")
assert roster["on"][1] == {"helper": "topic-gardener", "every": "days3", "next": "2026-11-12T02:00Z"}, roster
assert tally.parse_line("[read-as] tenant=t1 shown=2") == {"e": "readas", "tenant": "t1", "shown": 2}
assert tally.parse_line("[read-as] tenant=t1 corrected to=none")["to"] == "none"
assert tally.parse_line("[memory-chat] answer for t1: the flat in Ruzafa") is None

evs = [dict(run, at="2026-11-11T02:05:00Z"), dict(tap, at="2026-11-11T08:00:00Z"), dict(roster, at="2026-11-10T09:00:00Z"),
       dict(tally.parse_line("[inbox-tap] tenant=t2 helper=open-loops-finder kind=suggestion action=do item=x"), at="2026-11-11T09:00:00Z")]
day = tally.day_counts(evs, "2026-11-11", "t1")
assert day["helpers"]["open-loops"]["suggestions"] == 1 and day["helpers"]["topic-gardener"]["taps"] == {"not-now-reason": 1}
assert day["otherAccounts"]["taps"] == 1
check = tally.schedule_check(evs, "t1", tally.parse_ts("2026-11-13T00:00:00Z"))
assert [(c["helper"], c["verdict"]) for c in check] == [("open-loops", "ran"), ("topic-gardener", "missed")], check
print("tally: all checks passed")
