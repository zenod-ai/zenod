#!/usr/bin/env python3
"""E26-S28 it3: the tester thank-you sender sends each queued mail once, marks it, and never resends after a failed mark."""
import importlib.util
import os
import pathlib
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("tester_thanks_send", HERE / "send.py")
send = importlib.util.module_from_spec(spec)
spec.loader.exec_module(send)

MAIL = {"id": "acct-1", "to": "ana@example.org", "subject": "Thank you for testing Zenod", "text": "Hi Ana,", "html": "<p>Hi</p>", "queuedAt": "2026-11-15T00:00:00Z"}


class Fake:
    def __init__(self, mails, mark_codes=(200,), send_ok=True, nudges=None):
        self.mails = list(mails)
        self.nudges = None if nudges is None else list(nudges)
        self.mark_codes = list(mark_codes)
        self.send_ok = send_ok
        self.sends, self.marks, self.runs, self.closed = [], [], [], []

    def ops(self, method, path, body=None):
        if path.endswith("/mail-queue"):
            return 200, {"mode": "on", "mails": self.mails}
        if path.endswith("/whatsapp-nudge/queue"):
            return (404, {"error": "not found"}) if self.nudges is None else (200, {"mode": "on", "mails": self.nudges})
        code = self.mark_codes.pop(0) if self.mark_codes else 200
        if code == 200:
            self.marks.append({**body, "path": path})
            self.mails = [m for m in self.mails if m["id"] != body["id"]]
            if self.nudges is not None:
                self.nudges = [m for m in self.nudges if m["id"] != body["id"]]
        return code, {"result": "sent"} if code == 200 else {"error": "boom"}

    def console(self, method, path, body=None):
        if path == "/api/runs":
            self.runs.append(body)
            return 201, {"id": f"run_{len(self.runs)}"}
        if path.startswith("/api/runs/"):
            self.closed.append(body)
            return 200, {}
        if path == "/api/mcp/gmail":
            self.sends.append(body["params"]["arguments"])
            if not self.send_ok:
                return 200, {"result": {"isError": True, "content": [{"type": "text", "text": "daily send cap reached"}]}}
            return 200, {"result": {"content": [{"type": "text", "text": "sent to ana@example.org (Message-ID <abc@mail.gmail.com>); logged"}]}}
        raise AssertionError(path)


class TickTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        send.STATE = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def tick(self, fake, **kw):
        return send.tick(ops_call=fake.ops, console_call=fake.console, log=lambda *_: None, **kw)

    def test_nothing_queued_opens_no_run(self):
        fake = Fake([])
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual(fake.runs, [])

    def test_sends_once_and_marks_with_message_id(self):
        fake = Fake([MAIL])
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual(len(fake.sends), 1)
        self.assertEqual(fake.sends[0]["to"], "ana@example.org")
        self.assertEqual(fake.sends[0]["body"], "Hi Ana,")
        self.assertEqual(fake.marks, [{"id": "acct-1", "to": "ana@example.org", "via": "team-gmail", "messageId": "<abc@mail.gmail.com>", "path": "/api/ops/testers/onboarding/mail-sent"}])
        self.assertEqual(fake.closed[0]["outcome"], "progressed")
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual(len(fake.sends), 1)

    def test_failed_mark_is_retried_without_resending(self):
        fake = Fake([MAIL], mark_codes=(500,))
        self.assertEqual(self.tick(fake), 1)
        self.assertEqual(len(fake.sends), 1)
        self.assertEqual(fake.marks, [])
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual(len(fake.sends), 1)
        self.assertEqual(len(fake.marks), 1)
        self.assertEqual(len(fake.runs), 1)

    def test_refused_send_stops_and_marks_nothing(self):
        fake = Fake([MAIL, dict(MAIL, id="acct-2", to="bo@example.org")], send_ok=False)
        self.assertEqual(self.tick(fake), 1)
        self.assertEqual(len(fake.sends), 1)
        self.assertEqual(fake.marks, [])
        self.assertEqual(fake.closed[0]["outcome"], "failed")

    def test_dry_run_sends_nothing(self):
        fake = Fake([MAIL])
        self.assertEqual(self.tick(fake, dry_run=True), 0)
        self.assertEqual(fake.sends, [])
        self.assertEqual(fake.runs, [])


class NudgeTest(unittest.TestCase):
    """E26-S32: the next-day WhatsApp email rides the same tick and goes once, ever."""

    NUDGE = {"id": "nudge-acct-2", "to": "bo@example.org", "subject": "Your Zenod WhatsApp link", "text": "Hi Bo,", "html": "", "queuedAt": "2026-11-16T00:00:00Z"}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        send.STATE = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def tick(self, fake):
        return send.tick(ops_call=fake.ops, console_call=fake.console, log=lambda *_: None)

    def test_nudge_sent_and_marked_on_its_own_route(self):
        fake = Fake([MAIL], nudges=[self.NUDGE])
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual([s["subject"] for s in fake.sends], ["Thank you for testing Zenod", "Your Zenod WhatsApp link"])
        self.assertEqual(fake.marks[1]["path"], "/api/ops/testers/whatsapp-nudge/sent")
        self.assertEqual(fake.marks[1]["to"], "bo@example.org")
        self.assertEqual(len(fake.runs), 1)

    def test_nudge_never_resent_when_its_mark_failed(self):
        fake = Fake([], mark_codes=(503, 200), nudges=[self.NUDGE])
        self.assertEqual(self.tick(fake), 1)
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual(len(fake.sends), 1)
        self.assertEqual(len(fake.marks), 1)
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual(len(fake.sends), 1)

    def test_production_without_the_nudge_route_still_sends_thanks(self):
        fake = Fake([MAIL])
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual(len(fake.sends), 1)


if __name__ == "__main__":
    unittest.main()
