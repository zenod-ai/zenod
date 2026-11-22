#!/usr/bin/env python3
"""E26-S31: a tester stuck before WhatsApp over an hour is reported once per step; our bug also raises one alarm."""
import datetime as dt
import importlib.util
import os
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
os.environ["TESTER_STUCK_STATE"] = tempfile.mkdtemp()
spec = importlib.util.spec_from_file_location("tester_stuck_check", HERE / "check.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

NOW = dt.datetime(2026, 11, 16, 7, 0, tzinfo=dt.timezone.utc)


def tester(key, signed, step="code_expired", our=False):
    return {"account": f"d***@g*** …{key[-4:]}", "key": key, "signedUpAt": signed, "step": step,
            "text": "code issued, never sent", "ourBug": our}


class Tick(unittest.TestCase):
    def setUp(self):
        (pathlib.Path(os.environ["TESTER_STUCK_STATE"]) / "reported.json").unlink(missing_ok=True)
        self.desk, self.alarms = [], []

    def run_tick(self, testers, desk_ok=True, ops=None):
        return check.tick(ops_call=ops or (lambda m, p, b=None: (200, {"testers": testers})), sleep=lambda _: None,
                          desk_call=lambda items: (self.desk.append(items), desk_ok)[1],
                          alarm_call=lambda text: (self.alarms.append(text), "sent")[1], now=NOW, log=lambda *_: None)

    def test_reports_once_after_an_hour_and_again_on_a_new_step(self):
        ts = [tester("aaaa9477", "2026-11-13T20:35:31Z"), tester("bbbb1111", "2026-11-16T06:30:00Z"),
              tester("cccc2222", "2026-11-13T20:00:00Z", step="linked")]
        self.assertEqual(self.run_tick(ts), 0)
        self.assertEqual([k for k, _ in self.desk[0]], ["aaaa9477"])
        self.assertIn("signed up 2026-11-13 20:35Z", self.desk[0][0][1])
        self.run_tick(ts)
        self.assertEqual(len(self.desk), 1)
        self.assertEqual(self.alarms, [])
        self.run_tick([tester("aaaa9477", "2026-11-13T20:35:31Z", step="our_error", our=True)])
        self.assertEqual(len(self.desk), 2)
        self.assertIn("our bug", self.desk[1][0][1])
        self.assertEqual(len(self.alarms), 1)

    def test_a_failed_desk_note_is_retried(self):
        ts = [tester("aaaa9477", "2026-11-13T20:35:31Z")]
        self.assertEqual(self.run_tick(ts, desk_ok=False), 1)
        self.run_tick(ts)
        self.assertEqual(len(self.desk), 2)

    def test_a_binding_read_while_production_reconfirms_it_is_read_again(self):
        # 22 Nov 01:26Z and 03:26Z: the 15-minute tick landed in the 5-minute refresh and read a linked tester as setting up
        reads = []
        window = tester("dddd6839", "2026-11-16T04:55:53Z", step="channel_setting_up", our=True)
        linked = tester("dddd6839", "2026-11-16T04:55:53Z", step="linked")

        def ops(m, p, b=None):
            reads.append(1)
            return 200, {"testers": [window if len(reads) == 1 else linked]}

        self.assertEqual(self.run_tick(None, ops=ops), 0)
        self.assertEqual(len(reads), 2)
        self.assertEqual(self.desk, [])
        self.assertEqual(self.alarms, [])

    def test_a_binding_that_stays_setting_up_is_still_our_bug(self):
        reads = []
        stuck = tester("dddd6839", "2026-11-16T04:55:53Z", step="channel_setting_up", our=True)

        def ops(m, p, b=None):
            reads.append(1)
            return 200, {"testers": [stuck]}

        self.run_tick(None, ops=ops)
        self.assertEqual(len(reads), 1 + check.SETTLE_TRIES)
        self.assertIn("our bug", self.desk[0][0][1])
        self.assertEqual(len(self.alarms), 1)

    def test_unreadable_production_reports_nothing(self):
        r = check.tick(ops_call=lambda m, p, b=None: (404, {}), desk_call=lambda i: self.fail("no desk"), now=NOW, log=lambda *_: None)
        self.assertEqual(r, 2)


if __name__ == "__main__":
    unittest.main()
