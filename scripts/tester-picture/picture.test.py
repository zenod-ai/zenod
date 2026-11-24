#!/usr/bin/env python3
"""Tests for the daily tester picture (E7-S17) and Jordi's tester table (E7-S27): python3 scripts/tester-picture/picture.test.py"""
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


MCP_ON = {"connected": True, "via": "oauth", "at": "2026-11-20T10:00:00.000Z"}
MCP_OFF = {"connected": False, "via": None, "at": None}


def progress(*testers, since="2026-11-19T00:00:00Z"):
    return {"generatedAt": "x", "lastSeenSince": since, "testers": list(testers)}


def build(*testers, emails=None, **kw):
    rows = picture.rows_from_progress(progress(*testers, **kw), emails)
    return picture.strip_private(picture.build(rows, {"applications": 3}, NOW, "progress"))


class Model(unittest.TestCase):
    def test_two_stuck_at_whatsapp(self):
        p = build(tester("aaaa1111"), tester("bbbb2222"))
        self.assertEqual(p["punchline"], "2 testers: 0 set up a vault, MCP not readable yet, 0 linked WhatsApp, 0 saved a memory, 0 sent a voice note")
        # vault is the first step in his order; with a vault the stuck step is WhatsApp
        ok = {"set": True, "provider": "github", "status": "ready"}
        p = build(tester("aaaa1111", vault=ok), tester("bbbb2222", vault=ok))
        self.assertEqual(p["punchline"], "2 testers: 2 set up a vault, MCP not readable yet, 0 linked WhatsApp, 0 saved a memory, 0 sent a voice note")
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
        self.assertEqual(p["punchline"], "2 testers: 2 set up a vault, MCP not readable yet, 2 linked WhatsApp, 1 saved a memory, 0 sent a voice note")

    def test_mixed_stuck_steps(self):
        ok = {"set": True, "provider": "github", "status": "ready"}
        p = build(tester("aaaa1111"), tester("bbbb2222", vault=ok))
        self.assertEqual(p["stuck_by_step"], {"vault": 1, "whatsapp": 1})

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
        self.assertEqual(p["punchline"], "No tester has signed up yet: 3 applied, nothing to set up")
        text = json.dumps(build(tester("aaaa1111", whatsapp={"linked": False, "step": "x", "text": "code issued", "ourBug": False})))
        self.assertNotIn("@", text)  # no email readable: nothing invented
        self.assertNotIn("_since", text)

    def test_fallback_marks_unreadable_steps(self):
        setup = {"testers": [{"key": "aaaa9477", "account": "d***@g*** …9477", "signedUpAt": "2026-11-13T20:35:31Z",
                              "step": "waiting_for_code", "text": "code issued", "ourBug": False}]}
        watch = [{"account_id": "user-usr_…9477", "email": "Ann@Example.com", "saves": {"last_capture_any": None}}]
        p = picture.strip_private(picture.build(picture.rows_from_fallback(setup, watch), None, NOW, "fallback"))
        t = p["testers"][0]
        self.assertEqual(t["steps"], {"vault": None, "whatsapp": False, "message": False, "memory": False})
        self.assertEqual(p["unread_steps"], ["vault"])
        self.assertIsNone(p["logged_in_24h"])
        self.assertIn("Google Drive set up", p["caveat"])
        self.assertEqual(p["punchline"], "1 tester: 0 set up a vault, MCP not readable yet, 0 linked WhatsApp, 0 saved a memory, 0 sent a voice note")
        self.assertEqual(p["unread_cells"], ["drive", "github", "mcp", "voice", "welcome"])
        self.assertEqual(t["email"], "ann@example.com")
        self.assertEqual(t["label"], "ann@example.com")


class McpAndUse(unittest.TestCase):
    """E7-S31 (Jordi, vn_aa7447c3): MCP connected beside the setup steps, and reads and writes from WhatsApp and from agents."""

    USE = {"whatsapp": {"reads": 2, "writes": 5}, "agents": {"reads": 7, "writes": 1}, "agentReadsSince": "2026-11-25T00:00:00.000Z"}

    def test_mcp_column_sits_with_the_setup_steps(self):
        ids = [c["id"] for c in build(tester("aaaa1111"))["columns"]]
        self.assertEqual(ids[:5], ["signup", "drive", "github", "mcp", "whatsapp"])

    def test_mcp_cell_follows_the_route_and_is_counted_in_the_headline(self):
        p = build(tester("aaaa1111", mcp=MCP_ON), tester("bbbb2222", mcp={"connected": True, "via": "activity", "at": None}),
                  tester("cccc3333", mcp=MCP_OFF))
        by = {t["tester"]: t["cells"]["mcp"] for t in p["testers"]}
        self.assertEqual(by, {"…1111": True, "…2222": True, "…3333": False})
        self.assertEqual(p["column_counts"]["mcp"], 2)
        self.assertIn("2 connected MCP", p["punchline"])
        self.assertNotIn("mcp", p["unread_cells"])

    def test_reads_and_writes_per_tester_and_in_total(self):
        p = build(tester("aaaa1111", mcp=MCP_ON, memoryUse=self.USE),
                  tester("bbbb2222", mcp=MCP_OFF, memoryUse={"whatsapp": {"reads": 0, "writes": 0}, "agents": {"reads": 0, "writes": 0}, "agentReadsSince": None}))
        by = {t["tester"]: t["use"] for t in p["testers"]}
        self.assertEqual(by["…1111"], {"wa_writes": 5, "wa_reads": 2, "agent_writes": 1, "agent_reads": 7})
        self.assertEqual(by["…2222"], {"wa_writes": 0, "wa_reads": 0, "agent_writes": 0, "agent_reads": 0})
        self.assertEqual(p["use_totals"], {"wa_writes": 5, "wa_reads": 2, "agent_writes": 1, "agent_reads": 7})
        self.assertEqual([c["title"] for c in p["use_columns"]], ["WhatsApp writes", "WhatsApp reads", "Agent writes", "Agent reads"])
        self.assertIn("5 saved from WhatsApp", p["use_line"])
        self.assertIn("7 agent reads over MCP", p["use_line"])
        self.assertIn("Agent searches are counted from 24 Nov", p["use_line"])  # 25 Nov 00:00Z is 24 Nov in Mexico City
        self.assertIn("never what was said", p["use_line"])

    def test_counts_the_running_release_cannot_give_show_a_dash_never_a_zero(self):
        p = build(tester("aaaa1111"))
        self.assertEqual(p["testers"][0]["use"], {"wa_writes": None, "wa_reads": None, "agent_writes": None, "agent_reads": None})
        self.assertIsNone(p["use_totals"])
        self.assertIn("next release", p["use_line"])
        page = picture.render_page(p)
        self.assertEqual(page.count('<td class="n"'), 4)
        self.assertEqual(page.count(">–</td>"), 4)

    def test_page_and_picture_show_the_numbers(self):
        p = build(tester("aaaa1111", mcp=MCP_ON, memoryUse=self.USE, voiceNotes=0, welcomeSentAt=None))
        page = picture.render_page(p)
        for word in ("MCP connected", "WhatsApp writes", "WhatsApp reads", "Agent writes", "Agent reads", p["use_line"]):
            self.assertIn(word, page)
        self.assertIn('data-label="Agent reads">7</td>', page)
        self.assertIn('data-label="WhatsApp writes">5</td>', page)
        self.assertIn(p["use_line"], picture.render_html(p, picture.load_house()))


class Table(unittest.TestCase):
    """E7-S27: Jordi's seven columns, green or grey, one row per tester, no email or number."""

    def test_seven_columns_in_his_order(self):
        p = build(tester("aaaa1111"))
        self.assertEqual([c["title"] for c in p["columns"]], [
            "Signed up", "Google Drive set up", "GitHub set up", "MCP connected", "WhatsApp code confirmed", "One memory saved", "One voice note sent", "Welcome WhatsApp sent"])

    def test_cells_are_green_or_grey_per_provider(self):
        drive = tester("aaaa1111", vault={"set": True, "provider": "google_drive", "status": "ready"}, mcp=MCP_OFF)
        gh = tester("bbbb2222", vault={"set": True, "provider": "github", "status": "ready"},
                    whatsapp={"linked": True, "step": "linked", "text": "ok", "ourBug": False},
                    memoriesSaved=3, voiceNotes=1, welcomeSentAt="2026-11-21T06:05:00Z", mcp=MCP_ON)
        none = tester("cccc3333", voiceNotes=0, welcomeSentAt=None, mcp=MCP_OFF)
        p = build(drive, gh, none)
        by = {t["tester"]: t["cells"] for t in p["testers"]}
        self.assertEqual(by["…1111"], {"signup": True, "drive": True, "github": False, "mcp": False, "whatsapp": False, "memory": False, "voice": False, "welcome": False})
        self.assertEqual(by["…2222"], {"signup": True, "drive": False, "github": True, "mcp": True, "whatsapp": True, "memory": True, "voice": True, "welcome": True})
        self.assertEqual(by["…3333"], {"signup": True, "drive": False, "github": False, "mcp": False, "whatsapp": False, "memory": False, "voice": False, "welcome": False})
        for t in p["testers"]:
            self.assertTrue(all(v is True or v is False for v in t["cells"].values()))  # never a third state

    def test_cells_the_running_release_cannot_read_are_grey_and_named(self):
        p = build(tester("aaaa1111"))  # no voiceNotes / welcomeSentAt / mcp in the payload
        self.assertEqual(p["unread_cells"], ["mcp", "voice", "welcome"])
        self.assertFalse(p["testers"][0]["cells"]["voice"])
        self.assertIn("One voice note sent", p["caveat"])
        self.assertIn("grey", p["caveat"])
        ready = build(tester("aaaa1111", voiceNotes=0, welcomeSentAt=None, mcp=MCP_OFF))
        self.assertEqual(ready["unread_cells"], [])
        self.assertIsNone(ready["caveat"])

    def test_row_label_is_the_email_when_it_is_known(self):
        """Jordi, vn_c2e56f5c: 'can we just have a fucking email, bro?'"""
        p = build(tester("usr_aaaa9477", signedUpAt="2026-11-13T20:35:31.939Z"), emails={"aaaa9477": "ann@example.com"})
        t = p["testers"][0]
        self.assertEqual((t["label"], t["email"], t["tester"], t["since"]), ("ann@example.com", "ann@example.com", "…9477", "signed up 13 Nov"))

    def test_row_label_falls_back_to_date_and_last_four_when_no_email_is_readable(self):
        p = build(tester("usr_aaaa9477", signedUpAt="2026-11-13T20:35:31.939Z"))
        self.assertEqual(p["testers"][0]["label"], "13 Nov · …9477")
        self.assertIsNone(p["testers"][0]["email"])

    def test_emails_by_key_joins_on_the_last_eight_and_skips_rows_without_one(self):
        watch = [{"account_id": "acct-0000aaaa9477", "email": " Ann@Example.com "}, {"account_id": "x-1", "email": None},
                 {"account_id": None, "email": "no@example.com"}, {"account_id": "y-22222222", "email": "not an address"}]
        self.assertEqual(picture.emails_by_key(watch), {"aaaa9477": "ann@example.com"})
        self.assertEqual(picture.emails_by_key(None), {})

    def test_rows_in_sign_up_order_when_equally_set_up(self):
        a = tester("aaaa1111", signedUpAt="2026-11-20T10:00:00Z")
        b = tester("bbbb2222", signedUpAt="2026-11-13T10:00:00Z")
        self.assertEqual([t["tester"] for t in build(a, b)["testers"]], ["…2222", "…1111"])

    def test_headline_when_everyone_is_set_up(self):
        ok = {"set": True, "provider": "github", "status": "ready"}
        done = tester("aaaa1111", vault=ok, whatsapp={"linked": True, "step": "linked", "text": "ok", "ourBug": False},
                      memoriesSaved=1, voiceNotes=1, welcomeSentAt="2026-11-21T06:05:00Z", whatsappNotes=1, mcp=MCP_ON)
        self.assertEqual(build(done)["punchline"], "1 tester, all set up")
        # E7-S31: without MCP connected the tester is not all set up
        self.assertNotEqual(build({**done, "mcp": MCP_OFF})["punchline"], "1 tester, all set up")

    def test_phone_line_answers_his_question_and_never_holds_a_number(self):
        self.assertIn("none yet", picture.phone_line(2, 0))
        line = picture.phone_line(3, 1)
        self.assertIn("1 of 3", line)
        self.assertIn("Phylax", line)
        self.assertIn("never shows", line)
        self.assertNotRegex(line, r"\+?\d{7,}")
        self.assertEqual(build(tester("aaaa1111"))["phone_line"], picture.phone_line(1, 0))

    def test_page_and_png_html_carry_the_table_the_emails_and_no_number(self):
        ok = {"set": True, "provider": "google_drive", "status": "ready"}
        p = build(tester("aaaa9477", vault=ok, voiceNotes=0, welcomeSentAt=None), tester("bbbb2222", voiceNotes=0, welcomeSentAt=None),
                  emails={"aaaa9477": "ann@example.com", "bbbb2222": "bo@example.org"})
        page = picture.render_page(p)
        self.assertIn("data-page-shell", page)
        self.assertIn(p["punchline"], page)
        self.assertIn("Phone numbers:", page)
        self.assertEqual(page.count('<tr><th scope="row" class="who">'), 2)
        for email in ("ann@example.com", "bo@example.org"):
            self.assertIn(email, page)
            self.assertIn(email, picture.render_html(p, picture.load_house()))
        self.assertIn("signed up 19 Nov", page)
        self.assertNotRegex(page, r"\+?\d{7,}")
        self.assertIn("tailnet only", page)
        self.assertEqual(page.count('class="dot on"'), 3)   # two signed up + one drive
        self.assertEqual(page.count('class="dot off"'), 13)  # 16 cells, 3 green
        for word in ("Google Drive set up", "GitHub set up", "WhatsApp code confirmed", "One memory saved", "One voice note sent", "Welcome WhatsApp sent"):
            self.assertIn(word, page)
        house = picture.load_house()
        self.assertIn(p["punchline"], picture.render_html(p, house))

    def test_card_copy_shortens_the_emails_and_the_main_page_keeps_them(self):
        """The card check screenshots a page into this public repo: that copy never carries a full address."""
        p = build(tester("aaaa9477"), emails={"aaaa9477": "ann.long@example.com"})
        self.assertEqual(picture.mask_email("ann.long@example.com"), "an…@example.com")
        self.assertIn("ann.long@example.com", picture.render_page(p))
        card = picture.render_page(p, masked=True)
        self.assertNotIn("ann.long", card)
        self.assertIn("an…@example.com", card)
        self.assertIn("public repository", card)
        self.assertIn("signed up", card)
        with tempfile.TemporaryDirectory() as d:
            picture.write_page(p, pathlib.Path(d))
            self.assertIn("ann.long@example.com", (pathlib.Path(d) / "index.html").read_text())
            self.assertNotIn("ann.long", (pathlib.Path(d) / "card.html").read_text())

    def test_key_line_says_the_handshake_finished(self):
        p = build(tester("aaaa1111"))
        self.assertIn("handshake finished", p["key_line"])
        self.assertIn("sent it back", p["key_line"])
        self.assertIn(p["key_line"], picture.render_page(p))
        self.assertIn(p["key_line"], picture.render_html(p, picture.load_house()))

    def test_empty_table(self):
        p = build()
        page = picture.render_page(p)
        self.assertIn("No tester has signed up yet", page)

    def test_write_page_makes_index_png_and_json_and_survives_a_bad_folder(self):
        with tempfile.TemporaryDirectory() as d:
            png = pathlib.Path(d) / "x.png"
            png.write_bytes(b"PNG")
            pic = build(tester("aaaa1111"))
            out = picture.write_page(pic, pathlib.Path(d) / "page", png)
            self.assertTrue(out.exists())
            self.assertEqual((pathlib.Path(d) / "page" / "tester-table.png").read_bytes(), b"PNG")
            self.assertEqual(json.loads((pathlib.Path(d) / "page" / "tester-table.json").read_text())["schema"], "zenod-tester-picture/v2")
            blocker = pathlib.Path(d) / "file"
            blocker.write_text("x")
            self.assertIsNone(picture.write_page(pic, blocker / "sub", png))


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
            picture.PAGE_DIR = pathlib.Path(d) / "page"
            ok = lambda: (progress(tester("aaaa1111")), None, None, {"applications": 1})  # noqa: E731
            self.assertEqual(picture.run(now=NOW, sources=ok, png=lambda p, path: path.write_bytes(b"x")), 0)
            self.assertTrue((pathlib.Path(d) / "latest.json").exists())
            self.assertTrue((pathlib.Path(d) / "page" / "index.html").exists())
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


class EmailsReachTheOutput(unittest.TestCase):
    def test_run_reads_emails_from_tester_watch_into_json_page_and_picture_html(self):
        with tempfile.TemporaryDirectory() as d:
            picture.OUT = pathlib.Path(d)
            picture.PAGE_DIR = pathlib.Path(d) / "page"
            watch = [{"account_id": "acct-0000aaaa1111", "email": "ann@example.com"}]
            src = lambda: (progress(tester("aaaa1111")), None, watch, {"applications": 1})  # noqa: E731
            self.assertEqual(picture.run(now=NOW, sources=src, png=lambda p, path: path.write_bytes(b"x")), 0)
            latest = json.loads((pathlib.Path(d) / "latest.json").read_text())
            self.assertEqual(latest["testers"][0]["email"], "ann@example.com")
            self.assertEqual(latest["testers"][0]["label"], "ann@example.com")
            self.assertIn("ann@example.com", (pathlib.Path(d) / "page" / "index.html").read_text())

    def test_read_sources_reads_tester_watch_even_when_progress_is_live(self):
        seen = []

        def ops(method, path):
            return 200, {"testers": []}

        class R:
            returncode = 0
            stdout = json.dumps({"testers": [{"account_id": "x", "email": "ann@example.com"}]})

        def runner(cmd, **kw):
            seen.append(cmd[-1])
            return R()

        progress_, _setup, watch, _counts = picture.read_sources(ops_call=ops, run=runner, fetch=lambda: None)
        self.assertEqual(progress_, {"testers": []})
        self.assertEqual(watch[0]["email"], "ann@example.com")
        self.assertEqual(seen, ["tester-watch --json --no-stripe"])  # unredacted: it carries the email

    def test_a_failed_tester_watch_keeps_the_old_label_and_the_picture_goes_out(self):
        class R:
            returncode = 1
            stdout = ""

        _p, _s, watch, _c = picture.read_sources(ops_call=lambda m, p: (200, {"testers": []}), run=lambda *a, **k: R(), fetch=lambda: None)
        self.assertIsNone(watch)
        rows = picture.rows_from_progress(progress(tester("aaaa1111")), picture.emails_by_key(watch))
        self.assertTrue(picture.build(rows, None, NOW, "progress")["testers"][0]["label"].endswith("…1111"))


if __name__ == "__main__":
    unittest.main()
