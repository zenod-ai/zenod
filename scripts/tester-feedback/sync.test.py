#!/usr/bin/env python3
"""E7-S9: one link per tester (per person), made once, handed to production with its filed notes."""
import importlib.util
import os
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
os.environ["TESTER_FEEDBACK_STATE"] = tempfile.mkdtemp()
spec = importlib.util.spec_from_file_location("tester_feedback_sync", HERE / "sync.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def tester(account, email, link=None, test=False):
    return {"accountId": account, "email": email, "who": f"<{email}>", "test": test, "link": link}


class Tick(unittest.TestCase):
    def setUp(self):
        (pathlib.Path(os.environ["TESTER_FEEDBACK_STATE"]) / "links.json").unlink(missing_ok=True)
        self.made, self.posted = [], []

    def run_tick(self, testers, notes=(), console_ok=True):
        def ops_call(method, path, body=None):
            if method == "GET":
                return 200, {"testers": testers}
            self.posted.append(body["links"])
            return 200, {"saved": len(body["links"]), "refused": []}

        def console_call(method, path, body=None):
            if method == "POST":
                if not console_ok:
                    return 503, {}
                n = len(self.made) + 1
                self.made.append(body)
                return 201, {"id": f"fbl_{n:04d}", "url": f"https://signup.alpha9.io/api/public/feedback/tok{n:08d}"}
            return 200, {"notes": list(notes)}
        return sync.tick(ops_call=ops_call, console_call=console_call, log=lambda *_: None)

    def test_one_link_per_person_made_once(self):
        testers = [tester("user-a", "dana@x.io"), tester("user-b", "two@x.io"), tester("user-c", "two@x.io")]
        self.assertEqual(self.run_tick(testers), 0)
        self.assertEqual(len(self.made), 2)
        self.assertEqual(self.made[0], {"who": "<dana@x.io>", "product": "Zenod", "campaign": "testers"})
        links = {l["accountId"]: l for l in self.posted[-1]}
        self.assertEqual(links["user-b"]["linkId"], links["user-c"]["linkId"])
        self.run_tick(testers)
        self.assertEqual(len(self.made), 2)

    def test_counts_filed_notes_only_and_never_down(self):
        testers = [tester("user-a", "dana@x.io")]
        self.run_tick(testers, notes=[{"linkId": "fbl_0001", "state": "filed"}, {"linkId": "fbl_0001", "state": "recording"},
                                      {"linkId": "fbl_9999", "state": "filed"}])
        self.assertEqual(self.posted[-1][0]["notes"], 1)
        held = dict(self.posted[-1][0])
        self.run_tick([tester("user-a", "dana@x.io", link={"linkId": held["linkId"], "url": held["url"], "notes": 1})], notes=[])
        self.assertEqual(self.posted[-1][0]["notes"], 1)

    def test_a_link_production_holds_is_never_made_again(self):
        held = {"linkId": "fbl_old1", "url": "https://signup.alpha9.io/api/public/feedback/oldtoken1", "notes": 0}
        self.run_tick([tester("user-a", "dana@x.io", link=held)])
        self.assertEqual(self.made, [])
        self.assertEqual(self.posted[-1][0]["linkId"], "fbl_old1")

    def test_console_down_makes_nothing_and_retries(self):
        self.run_tick([tester("user-a", "dana@x.io")], console_ok=False)
        self.assertEqual(self.posted, [])
        self.run_tick([tester("user-a", "dana@x.io")])
        self.assertEqual(len(self.made), 1)


if __name__ == "__main__":
    unittest.main()
