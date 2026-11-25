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

MAIL = {"id": "acct-1", "to": "ana@example.org", "subject": "Thank you for testing Zenod", "text": "Hi Ana,", "html": "<p>Hi</p>", "queuedAt": "2026-11-15T00:00:00Z",
        "facts": {"address_from": "the address they signed in to Zenod with", "name": "Ana", "name_from": "their tester application"}}


class Fake:
    def __init__(self, mails, mark_codes=(200,), send_ok=True, nudges=None, welcomes=None, setups=None):
        self.setups = None if setups is None else list(setups)
        self.mails = list(mails)
        self.nudges = None if nudges is None else list(nudges)
        self.welcomes = None if welcomes is None else list(welcomes)
        self.mark_codes = list(mark_codes)
        self.send_ok = send_ok
        self.sends, self.marks, self.runs, self.closed = [], [], [], []

    def ops(self, method, path, body=None):
        if path.endswith("/mail-queue"):
            return 200, {"mode": "on", "mails": self.mails}
        if path.endswith("/whatsapp-nudge/queue"):
            return (401, {"error": "unauthorized"}) if self.nudges is None else (200, {"mode": "on", "mails": self.nudges})
        if path.endswith("/setup-email/queue"):
            return (404, {"error": "not found"}) if self.setups is None else (200, {"mode": "on", "mails": self.setups})
        if path.endswith("/signup-welcome/queue"):
            return (404, {"error": "not found"}) if self.welcomes is None else (200, {"mode": "on", "mails": self.welcomes})
        code = self.mark_codes.pop(0) if self.mark_codes else 200
        if code == 200:
            self.marks.append({**body, "path": path})
            self.mails = [m for m in self.mails if m["id"] != body["id"]]
            if self.nudges is not None:
                self.nudges = [m for m in self.nudges if m["id"] != body["id"]]
            if self.welcomes is not None:
                self.welcomes = [m for m in self.welcomes if m["id"] != body["id"]]
            if self.setups is not None:
                self.setups = [m for m in self.setups if m["id"] != body["id"]]
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


class FactsTest(unittest.TestCase):
    """E7-S40: gmail_send gets the facts from the account record; missing or unsure, nothing is sent and it says what."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        send.STATE = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def run_tick(self, fake, **kw):
        lines = []
        code = send.tick(ops_call=fake.ops, console_call=fake.console, log=lines.append, **kw)
        return code, lines

    def test_facts_are_passed_to_gmail_send(self):
        fake = Fake([MAIL])
        self.assertEqual(self.run_tick(fake)[0], 0)
        self.assertEqual(fake.sends[0]["facts"], {"address_from": "the address they signed in to Zenod with", "name": "Ana", "name_from": "their tester application"})

    def test_no_facts_sends_nothing_and_says_what_is_missing(self):
        bare = {k: v for k, v in MAIL.items() if k != "facts"}
        fake = Fake([bare])
        code, lines = self.run_tick(fake)
        self.assertEqual((code, fake.sends, fake.marks, fake.runs), (0, [], [], []))
        self.assertIn("Zenod sent no facts", " ".join(lines))

    def test_unsure_name_sends_nothing(self):
        unsure = {**MAIL, "text": "Hi,", "facts": {"address_from": "the address they signed in to Zenod with",
                                                   "missing": ['name: unsure, "Mark" from their application but "Vitor" from their Google sign-in']}}
        fake = Fake([unsure])
        code, lines = self.run_tick(fake)
        self.assertEqual((fake.sends, fake.marks), ([], []))
        self.assertIn('unsure, "Mark"', " ".join(lines))
        self.assertNotIn("ana@example.org", " ".join(lines))

    def test_empty_address_from_is_held(self):
        fake = Fake([{**MAIL, "facts": {"address_from": ""}}])
        _, lines = self.run_tick(fake)
        self.assertEqual(fake.sends, [])
        self.assertIn("address: where it came from", " ".join(lines))

    def test_hold_list_holds_a_listed_tester_and_lets_others_go(self):
        other = {**MAIL, "id": "acct-2", "to": "bo@example.org"}
        fake = Fake([MAIL, other])
        (send.STATE / "hold.json").write_text('{"accounts": ["acct-1"], "reason": "E105-S306 writes the next note"}')
        _, lines = self.run_tick(fake)
        self.assertEqual([s["to"] for s in fake.sends], ["bo@example.org"])
        self.assertIn("on hold: E105-S306 writes the next note", " ".join(lines))

    def test_dry_run_lists_held_mail_too(self):
        fake = Fake([{**MAIL, "facts": {}}])
        _, lines = self.run_tick(fake, dry_run=True)
        self.assertTrue(any(line.startswith("held, not sent") for line in lines))


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

    NUDGE = {"id": "nudge-acct-2", "to": "bo@example.org", "subject": "Your Zenod WhatsApp link", "text": "Hi Bo,", "html": "", "queuedAt": "2026-11-16T00:00:00Z",
             "facts": {"address_from": "the address they signed in to Zenod with", "name": "Bo", "name_from": "their Google sign-in"}}

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


class SetupEmailTest(unittest.TestCase):
    """E7-S28: Jordi's setup email rides the same tick and ledger, once per tester, ever."""

    SETUP = {"id": "setup-acct-3", "to": "cy@example.org", "subject": "Your Zenod setup", "text": "Hey,", "html": "", "queuedAt": "2026-11-19T00:00:00Z", "facts": {"address_from": "the address they signed in to Zenod with"}}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        send.STATE = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def tick(self, fake):
        return send.tick(ops_call=fake.ops, console_call=fake.console, log=lambda *_: None)

    def test_sent_and_marked_on_its_own_route(self):
        fake = Fake([], setups=[self.SETUP])
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual([s["subject"] for s in fake.sends], ["Your Zenod setup"])
        self.assertEqual(fake.marks[0]["path"], "/api/ops/testers/setup-email/sent")
        self.assertEqual(fake.marks[0]["to"], "cy@example.org")

    def test_sent_by_hand_before_the_route_exists_is_only_marked(self):
        send.write_ledger({"setup-acct-3": {"to": "cy@example.org", "sentAt": "2026-11-22T20:00:00+00:00", "messageId": "<m@x>", "run": "run_x"}})
        fake = Fake([], setups=[self.SETUP])
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual(fake.sends, [])
        self.assertEqual(fake.marks[0]["path"], "/api/ops/testers/setup-email/sent")
        self.assertEqual(fake.marks[0]["messageId"], "<m@x>")

    def test_never_resent_when_its_mark_failed(self):
        fake = Fake([], mark_codes=(503, 200), setups=[self.SETUP])
        self.assertEqual(self.tick(fake), 1)
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual(len(fake.sends), 1)

    def test_production_without_the_route_is_skipped(self):
        fake = Fake([MAIL])
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual(len(fake.sends), 1)


class WelcomeTest(unittest.TestCase):
    """E26-S33: the sign-up welcome goes first in the tick, once, ever, on its own route."""

    WELCOME = {"id": "welcome-acct-1", "to": "ana@example.org", "subject": "Welcome to Zenod, here is how to start", "text": "Hi,", "html": "", "queuedAt": "2026-11-17T00:00:00Z", "facts": {"address_from": "the address they signed in to Zenod with"}}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        send.STATE = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def tick(self, fake):
        return send.tick(ops_call=fake.ops, console_call=fake.console, log=lambda *_: None)

    def test_welcome_goes_before_the_thank_you_and_the_nudge(self):
        nudge = dict(NudgeTest.NUDGE)
        fake = Fake([MAIL], nudges=[nudge], welcomes=[self.WELCOME])
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual([s["subject"] for s in fake.sends], ["Welcome to Zenod, here is how to start", "Thank you for testing Zenod", "Your Zenod WhatsApp link"])
        self.assertEqual(fake.marks[0]["path"], "/api/ops/testers/signup-welcome/sent")
        self.assertEqual(len(fake.runs), 1)

    def test_welcome_never_resent_when_its_mark_failed(self):
        fake = Fake([], mark_codes=(503, 200), welcomes=[self.WELCOME])
        self.assertEqual(self.tick(fake), 1)
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual(len(fake.sends), 1)
        self.assertEqual(len(fake.marks), 1)

    def test_production_without_the_welcome_route_still_sends_thanks(self):
        fake = Fake([MAIL])
        self.assertEqual(self.tick(fake), 0)
        self.assertEqual(len(fake.sends), 1)


if __name__ == "__main__":
    unittest.main()
