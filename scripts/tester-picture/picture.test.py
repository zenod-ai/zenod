#!/usr/bin/env python3
"""Tests for the daily tester picture (E7-S17): python3 scripts/tester-picture/picture.test.py"""
import datetime as dt
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import picture  # noqa: E402

NOW = dt.datetime(2026, 11, 21, 11, 30, tzinfo=dt.timezone.utc)


def tester(key, **kw):
    t = {"key": key, "signedUpAt": "2026-11-19T19:03:30Z",
         "vault": {"set": False, "provider": None, "status": None},
         "whatsapp": {"linked": False, "step": "code_expired", "text": "code issued", "ourBug": False},
         "whatsappNotes": 0, "whatsappNotes24h": 0, "memoriesSaved": 0, "memoriesSaved24h": 0, "lastSeenAt": None}
    t.update(kw)
    return t


def progress(*testers, since="2026-11-19T00:00:00Z"):
    return {"generatedAt": "x", "lastSeenSince": since, "testers": list(testers)}


def build(*testers, **kw):
    rows = picture.rows_from_progress(progress(*testers, **kw))
    return picture.strip_private(picture.build(rows, {"applications": 3}, NOW, "progress"))


class Model(unittest.TestCase):
    def test_two_stuck_at_whatsapp(self):
        p = build(tester("aaaa1111"), tester("bbbb2222"))
        self.assertEqual(p["punchline"], "2 testers, 0 fully set up: both stuck at the vault")
        # vault is the first step in his order; with a vault the stuck step is WhatsApp
        ok = {"set": True, "provider": "github", "status": "ready"}
        p = build(tester("aaaa1111", vault=ok), tester("bbbb2222", vault=ok))
        self.assertEqual(p["punchline"], "2 testers, 0 fully set up: both stuck at WhatsApp")
        self.assertEqual(p["signed_up"], 2)
        self.assertEqual(p["applied"], 3)
        self.assertEqual(p["testers"][0]["stuck_at"], "whatsapp")
        self.assertEqual(p["testers"][0]["owner"], picture.OWNER)

    def test_fully_set_up_needs_all_four(self):
        ok = {"set": True, "provider": "google_drive", "status": "ready"}
        done = tester("cccc3333", vault=ok, whatsapp={"linked": True, "step": "linked", "text": "ok", "ourBug": False},
                      whatsappNotes=2, memoriesSaved=1, lastSeenAt="2026-11-21T08:00:00Z", whatsappNotes24h=1, memoriesSaved24h=1)
        nomem = {**done, "key": "dddd4444", "memoriesSaved": 0}
        p = build(done, nomem)
        self.assertEqual(p["fully_set_up"], 1)
        self.assertEqual(p["testers"][0]["tester"], "…4444")  # stuck testers first
        self.assertEqual(p["testers"][0]["stuck_at"], "memory")
        self.assertTrue(p["testers"][1]["fully_set_up"])
        self.assertEqual(p["testers"][1]["next"], "none: keep watching their use")
        self.assertEqual(p["punchline"], "2 testers, 1 fully set up: 1 at their first memory")

    def test_mixed_stuck_steps(self):
        ok = {"set": True, "provider": "github", "status": "ready"}
        p = build(tester("aaaa1111"), tester("bbbb2222", vault=ok))
        self.assertEqual(p["punchline"], "2 testers, 0 fully set up: 1 at the vault, 1 at WhatsApp")

    def test_logged_in_window_and_unknown(self):
        recent = tester("aaaa1111", lastSeenAt="2026-11-21T01:00:00Z")
        old = tester("bbbb2222", lastSeenAt="2026-11-19T01:00:00Z")
        never = tester("cccc3333")
        p = build(recent, old, never)
        by = {t["tester"]: t["logged_in_24h"] for t in p["testers"]}
        self.assertEqual(by, {"…1111": True, "…2222": False, "…3333": False})  # the record ran for more than a day
        self.assertEqual(p["logged_in_24h"], 1)
        young = build(never, since="2026-11-21T06:00:00Z")  # record began 5 h ago: not seen is not yet "stayed away"
        self.assertIsNone(young["testers"][0]["logged_in_24h"])
        self.assertIsNone(young["logged_in_24h"])

    def test_our_bug_changes_the_next_step(self):
        bug = tester("aaaa1111", vault={"set": True, "provider": "github", "status": "ready"},
                     whatsapp={"linked": False, "step": "our_error", "text": "code request failed with 503", "ourBug": True})
        t = build(bug)["testers"][0]
        self.assertTrue(t["our_bug"])
        self.assertIn("fix our side first", t["next"])

    def test_no_testers_and_privacy(self):
        p = build()
        self.assertEqual(p["punchline"], "No tester has signed up yet: 3 applied, 0 fully set up")
        text = json.dumps(build(tester("aaaa1111", whatsapp={"linked": False, "step": "x", "text": "code issued", "ourBug": False})))
        self.assertNotIn("@", text)
        self.assertNotIn("_since", text)

    def test_fallback_marks_unreadable_steps(self):
        setup = {"testers": [{"key": "aaaa9477", "account": "d***@g*** …9477", "signedUpAt": "2026-11-13T20:35:31Z",
                              "step": "waiting_for_code", "text": "code issued", "ourBug": False}]}
        watch = [{"account_id": "user-usr_…9477", "saves": {"last_capture_any": None}}]
        p = picture.strip_private(picture.build(picture.rows_from_fallback(setup, watch), None, NOW, "fallback"))
        t = p["testers"][0]
        self.assertEqual(t["steps"], {"vault": None, "whatsapp": False, "message": False, "memory": False})
        self.assertEqual(p["unread_steps"], ["vault"])
        self.assertIsNone(p["logged_in_24h"])
        self.assertIn("vault", p["caveat"])
        self.assertEqual(p["punchline"], "1 tester, 0 fully set up: stuck at WhatsApp")


class Files(unittest.TestCase):
    def test_write_makes_day_and_latest_and_survives_a_failed_picture(self):
        with tempfile.TemporaryDirectory() as d:
            out = pathlib.Path(d)
            pic = build(tester("aaaa1111"))

            def fake_png(p, path):
                path.write_bytes(b"PNG")

            jpath, ppath = picture.write(pic, out, fake_png)
            self.assertTrue(jpath.exists() and ppath.exists())
            self.assertEqual(json.loads((out / "latest.json").read_text())["png"], str(out / "latest.png"))
            self.assertEqual((out / "latest.png").read_bytes(), b"PNG")

            def broken(p, path):
                raise RuntimeError("no chrome")

            jpath, ppath = picture.write(pic, out / "b", broken)
            self.assertIsNone(ppath)
            self.assertIsNone(json.loads(jpath.read_text())["png"])

    def test_run_reads_progress_then_falls_back_then_fails(self):
        with tempfile.TemporaryDirectory() as d:
            picture.OUT = pathlib.Path(d)
            ok = lambda: (progress(tester("aaaa1111")), None, None, {"applications": 1})  # noqa: E731
            self.assertEqual(picture.run(now=NOW, sources=ok, png=lambda p, path: path.write_bytes(b"x")), 0)
            self.assertTrue((pathlib.Path(d) / "latest.json").exists())
            self.assertEqual(picture.run(now=NOW, sources=lambda: (None, None, None, None)), 2)

    def test_read_sources_falls_back_when_progress_is_not_live(self):
        calls = []

        def ops(method, path):
            calls.append(path)
            return (404, {}) if path.endswith("/progress") else (200, {"testers": []})

        class R:
            returncode = 0
            stdout = json.dumps({"testers": [{"account_id": "x"}]})

        progress_, setup, watch, counts = picture.read_sources(ops_call=ops, run=lambda *a, **k: R(), fetch=lambda: {"applications": 2})
        self.assertIsNone(progress_)
        self.assertEqual(setup, {"testers": []})
        self.assertEqual(watch, [{"account_id": "x"}])
        self.assertEqual(counts, {"applications": 2})
        self.assertEqual(calls, ["/api/ops/testers/progress", "/api/ops/testers/whatsapp-setup"])


if __name__ == "__main__":
    unittest.main()
