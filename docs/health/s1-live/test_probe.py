#!/usr/bin/env python3
"""ZAL-A11: the probe reads every container Docker still keeps for a service, not just the running one.

    python3 docs/health/s1-live/test_probe.py
"""

import os
import sys
import json
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import probe as P  # noqa: E402


class LogSpans(unittest.TestCase):
    since = P.parse_ts("2026-11-01T19:45:00Z")
    now = P.parse_ts("2026-11-08T19:45:00Z")

    def test_rolls_every_20_min_keep_the_failures_before_the_roll(self):
        # 2026-11-08: saves failed from 16:14Z while production rolled at 18:25, 18:43, 19:05, 19:24 and 19:44
        past = [
            {"id": "c", "startedAt": "2026-11-08T19:05:00.5Z", "finishedAt": "2026-11-08T19:24:49.1Z"},
            {"id": "a", "startedAt": "2026-11-08T18:25:21.6Z", "finishedAt": "2026-11-08T18:43:58.7Z"},
            {"id": "b", "startedAt": "2026-11-08T18:43:59.0Z", "finishedAt": "2026-11-08T19:05:00.1Z"},
        ]
        cur = {"id": "d", "startedAt": "2026-11-08T19:44:35.1Z"}
        spans = P.log_spans(cur, past, self.since, self.now)
        self.assertEqual([s[0] for s in spans], ["a", "b", "c", "d"])
        self.assertEqual(spans[0], ("a", "2026-11-08T18:25:20Z", "2026-11-08T18:43:59Z"))
        self.assertEqual(spans[-1], ("d", "2026-11-08T19:44:34Z", "2026-11-08T19:45:00Z"))

    def test_containers_older_than_the_window_or_never_started_are_skipped(self):
        past = [{"id": "old", "startedAt": "2026-10-20T00:00:00Z", "finishedAt": "2026-10-25T00:00:00Z"},
                {"id": "created", "startedAt": "0001-01-01T00:00:00Z", "finishedAt": None}]
        self.assertEqual(P.log_spans(None, past, self.since, self.now), [])

    def test_a_container_running_since_before_the_window_starts_at_the_window(self):
        cur = {"id": "d", "startedAt": "2026-10-01T00:00:00Z"}
        self.assertEqual(P.log_spans(cur, [], self.since, self.now),
                         [("d", "2026-11-01T19:45:00Z", "2026-11-08T19:45:00Z")])


class TailNew(unittest.TestCase):
    """ZAL-A18: the access log is read from where the last run stopped; logrotate's copytruncate keeps the inode."""

    def setUp(self):
        import tempfile
        self.d = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.d.name, "access.log")

    def tearDown(self):
        self.d.cleanup()

    def write(self, text, mode="a"):
        with open(self.path, mode) as f:
            f.write(text)

    def read(self, mark):
        return P.tail_new(self.path, mark, cat=("cat",))

    def test_only_new_complete_lines_are_returned(self):
        self.write('{"n":1}\n{"n":2}\n{"n":3')
        lines, mark, fresh = self.read(None)
        self.assertEqual((lines, fresh), (['{"n":1}', '{"n":2}'], True))
        self.write('}\n{"n":4}\n')
        lines, mark, fresh = self.read(mark)
        self.assertEqual((lines, fresh), (['{"n":3}', '{"n":4}'], False))
        self.assertEqual(self.read(mark)[:2], ([], mark))

    def test_copytruncate_rotation_reads_the_new_file_from_the_start(self):
        self.write("".join(f'{{"day":1,"n":{i}}}\n' for i in range(100)))
        _, mark, _ = self.read(None)
        self.write('{"day":2,"n":0}\n', mode="r+")     # same inode, new first bytes
        with open(self.path, "r+") as f:
            f.truncate(len('{"day":2,"n":0}\n'))
        lines, _, fresh = self.read(mark)
        self.assertEqual((lines, fresh), (['{"day":2,"n":0}'], True))

    def test_a_short_file_grows_past_its_first_256_bytes(self):
        self.write('{"a":1}\n')
        _, mark, _ = self.read(None)
        self.write("".join(f'{{"b":{i}}}\n' for i in range(60)))
        lines, mark, fresh = self.read(mark)
        self.assertFalse(fresh)
        self.assertEqual(len(lines), 60)
        self.write('{"c":1}\n')
        self.assertEqual(self.read(mark)[0], ['{"c":1}'])

    def test_an_emptied_file_starts_over(self):
        self.write('{"a":1}\n')
        _, mark, _ = self.read(None)
        open(self.path, "w").close()
        self.assertEqual(self.read(mark)[0::2], ([], True))


class Folds(unittest.TestCase):
    def test_incremental_folds_equal_one_whole_read(self):
        t = [P.parse_ts(f"2026-11-09T10:{m:02d}:00Z") for m in range(6)]
        lines = [(t[0], "[task-job] a done: store"), (t[1], "[task-job] b failed (store): x"),
                 (t[2], "[task-job] c done: chat"), (t[3], '{"level":50,"event":"boom"}'),
                 (t[4], "[memory-search] tier-0 index, 12.5 ms (40 rows"), (t[5], "[task-job] d failed (store): y")]
        new = lambda: {"lastJob": None, "jobs": [], "lastIndex": None, "lastError": None, "errs": [], "lines": {},
                       "capturesFailingSince": None, "chat": []}
        whole, parts = new(), new()
        P.zenod_fold(whole, lines)
        P.zenod_fold(parts, lines[:2])
        P.zenod_fold(parts, lines[2:])
        self.assertEqual(whole, parts)
        self.assertEqual(whole["capturesFailingSince"], "2026-11-09T10:01:00Z")   # a chat job is not a save
        self.assertEqual(len(whole["jobs"]), 2)

    def test_failure_lines_become_ops_events_with_fixed_words_only(self):
        cases = {
            "[ops-alert] signin callback_failed provider=google name=Error": ("signin", "callback_failed"),
            "[ops-alert] app client_api name=ApiError page=/app/chat status=502": ("app", "client_api"),
            "[ops-alert] save stuck n=1 oldest_min=17": ("save", "stuck"),
            "[ops-alert] answer ask_brain_timeout secs=120": ("answer", "ask_brain_timeout"),
            "[ops-alert] helper run_failed helper=weekly-recap": ("helper", "run_failed"),
            "[task-job] 3f2a failed (media_ingest): Error: my private words": ("save", "media_ingest_failed"),
            "[task-job] 3f2a failed (chat): Error: what did I say": ("answer", "chat_failed"),
            "[task-job] chat lane failed: x": ("answer", "chat_failed"),
            "[chat] stream failed: x": ("answer", "stream_failed"),
            "[task-job] 3f2a done: store": None,
            "[ops-alert] unknown thing": None,
        }
        for line, want in cases.items():
            self.assertEqual(P.ops_event(line), want, line)
        z = {"lastJob": None, "jobs": [], "lastIndex": None, "lastError": None, "errs": [], "lines": {},
             "capturesFailingSince": None, "chat": []}
        P.zenod_fold(z, [(P.parse_ts("2026-11-10T03:00:00Z"), "[task-job] a failed (store): Error: secret")])
        self.assertEqual(z["ops"], [["2026-11-10T03:00:00Z", "save", "store_failed"]])
        self.assertNotIn("secret", json.dumps(z["ops"]))


if __name__ == "__main__":
    unittest.main()
