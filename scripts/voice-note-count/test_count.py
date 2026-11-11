"""EPIC-21 V6: a note matches its Zenod entry by id only; tests and short calls stay out. Run: python3 -I scripts/voice-note-count/test_count.py"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import count  # noqa: E402

h = count.source_hash("vn_aaaa1111")
log = f"""# 2026-11-10

## 00:50 Voice note  ^e-111111
- source: mcp
- content-type: voice_note
- source-id: tenant:forward:fcfb501a0484:{h}

> Source app: EpicTeam card answer
> Source timestamp: 2026-11-10T00:50:21.710Z

## 01:10 Call transcript  ^e-333333
- source: mcp
- content-type: voice_note
- source-id: call_1

> Source app: EpicTeam call

## 01:20 a store_memory note from elsewhere  ^e-444444
- source-id: zmr-deployment-learnings-abcdef12

## 01:00 a text memo that quotes "Source app: EpicTeam Chat"  ^e-222222
- source: mcp
"""
landed = count.parse_vault_log(log)
assert landed == {h: "EpicTeam card answer", "call_1": "EpicTeam call"}, landed

console = {
    "notes": [
        ["vn_aaaa1111", "alpha9", "transcribed", "2026-11-09T10:00:00Z", 30, True, "sent", None],
        ["vn_bbbb2222", "alpha9", "posted", "2026-11-09T11:00:00Z", 20, True, "failed", "unreachable"],
        ["vn_8a891947", "alpha9", "transcribed", "2026-11-09T12:00:00Z", 5, True, "sent", None],
        ["vn_cccc3333", "alpha9", "discarded", "2026-11-09T12:00:00Z", 5, False, None, None],
    ],
    "calls": [
        ["call_1", "alpha9", "2026-11-09T13:00:00Z", 120, True],
        ["call_2", "alpha9", "2026-11-09T13:05:00Z", 3, False],
        ["call_46755499", "zenod-social", "2026-11-02T13:05:00Z", 900, False],
        ["call_3", "alpha9", "2026-11-09T14:05:00Z", 60, True, "skipped", "no_words"],
    ],
}
r = count.compute(console, landed, dt.datetime(2026, 11, 10, 12, tzinfo=count.UTC))
assert r["week"]["card"] == {"left": 1, "landed": 1, "waiting": 0, "failed": 0, "never_sent": 0}, r["week"]["card"]
assert r["week"]["chat"]["failed"] == 1 and r["week"]["chat"]["landed"] == 0
assert r["week"]["call"] == {"left": 1, "landed": 1, "waiting": 0, "failed": 0, "never_sent": 0}, r["week"]["call"]
assert r["all"]["all"] == {"left": 3, "landed": 2}, r["all"]["all"]
assert r["skipped"] == {"discarded": 1, "empty": 0, "unfinished": 0, "test": 1, "short call": 1, "no words": 2}, r["skipped"]
g = count.gaps(r)
assert any("1 failed" in x for x in g) and not any(x.startswith("Calls") for x in g), g
page = count.render(r, [])
assert "67%" in page and "vn_" not in page and "2 calls that kept none of your words" in page
r0 = count.compute(console, {h: "EpicTeam card answer"}, dt.datetime(2026, 11, 10, 12, tzinfo=count.UTC))
assert any(x.startswith("Calls are not sent") for x in count.gaps(r0))
print("ok")
