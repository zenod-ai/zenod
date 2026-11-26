#!/usr/bin/env python3
"""E7-S43: the weekly Google rank line: zenod.dev's place, ours counted, Zenodo never ours, one line per week."""
import datetime as dt
import importlib.util
import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("google_rank", HERE / "rank.py")
rank = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rank)


def ans(*urls, engine="google"):
    return {"engine": engine, "results": [{"url": u, "title": "t", "snippet": ""} for u in urls]}


class Rank(unittest.TestCase):
    def test_place_and_ours(self):
        line = rank.score(ans("https://zenodo.org/", "https://www.reddit.com/r/x/comments/1/looking_for_testers_for_zenod/",
                              "https://glama.ai/mcp/connectors/io.github.zenod-ai/zenod", "https://zenod.dev/"))
        self.assertEqual((line["pos"], line["ours"], line["read"]), (4, 3, True))

    def test_zenodo_is_not_ours(self):
        line = rank.score(ans("https://zenodo.org/", "https://github.com/zenodo/zenodo"))
        self.assertEqual((line["pos"], line["ours"]), (None, 0))

    def test_other_engine_is_no_read(self):
        self.assertFalse(rank.score(ans("https://zenod.dev/", engine="parallel"))["read"])

    def test_refused_search_retried_once(self):
        calls = []

        def searcher(q):
            calls.append(q)
            return ans("https://zenod.dev/") if calls.count(q) > 1 or q != "zenod" else ans(engine="exa")
        out = rank.measure(searcher, sleep=lambda _: None)
        self.assertEqual(calls.count("zenod"), 2)
        self.assertEqual(out["zenod"]["pos"], 1)
        self.assertEqual(len(out), 6)

    def test_one_line_per_week_baseline_kept(self):
        base = [{"date": "2026-11-26", "baseline": True, "depth": 20, "results": {}}]
        r = {q: {"pos": 2, "ours": 1, "read": True} for q in rank.QUERIES}
        h = rank.add_week(base, dt.datetime(2026, 11, 26, 6, tzinfo=dt.timezone.utc), r)
        h = rank.add_week(h, dt.datetime(2026, 11, 27, 6, tzinfo=dt.timezone.utc), r)
        self.assertEqual(len(h), 2)
        h = rank.add_week(h, dt.datetime(2026, 12, 3, 6, tzinfo=dt.timezone.utc), r)
        self.assertEqual([x["date"] for x in h], ["2026-11-26", "2026-11-27", "2026-12-03"])

    def test_page_section_replaced_in_place(self):
        page = '<section id="plan"></section>\n<section id="answer"></section>'
        h = [{"date": "2026-11-26", "depth": 6, "results": {"zenod memory": {"pos": 4, "ours": 4, "read": True},
                                                           "zenod": {"pos": None, "ours": 0, "read": True}}}]
        once = rank.put_section(page, rank.render(h))
        self.assertIn('id="weekly"', once)
        self.assertLess(once.index('id="weekly"'), once.index('id="answer"'))
        twice = rank.put_section(once, rank.render(h))
        self.assertEqual(twice.count('id="weekly"'), 1)
        self.assertIn('&quot;zenod memory&quot; 4th', twice)
        self.assertIn('&quot;zenod&quot; not in the top 6', twice)


if __name__ == "__main__":
    unittest.main()
