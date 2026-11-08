#!/usr/bin/env python3
"""ZAL-A11: the probe reads every container Docker still keeps for a service, not just the running one.

    python3 docs/health/s1-live/test_probe.py
"""

import os
import sys
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


if __name__ == "__main__":
    unittest.main()
