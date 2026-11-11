#!/usr/bin/env python3
"""Unit tests for tester_watch.py against fixture volumes. Run: python3 scripts/tester-watch/tester_watch.test.py"""
import importlib.util
import json
import re
import sqlite3
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("tw", HERE / "tester_watch.py")
tw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tw)

NOW = 1_793_000_000_000  # 2026-10-26T09:33:20Z
DAY = tw.DAY_MS


class FakeStripe:
    def __init__(self, subs, preview=0, pms=False, codes=None):
        self.subs, self.preview, self.pms, self.codes = subs, preview, pms, codes or {}
        self.calls = []

    def subscription(self, sid):
        self.calls.append(("sub", sid))
        return self.subs[sid]

    def has_payment_method(self, cid):
        return self.pms

    def next_invoice(self, sid):
        self.calls.append(("preview", sid))
        return {"amount_due": self.preview}

    def promotion_code(self, code):
        return self.codes.get(code)


def sub(status="active", renew_in_days=20, code="TESTER-ANA", duration="once"):
    return {
        "status": status, "currency": "eur", "cancel_at_period_end": False,
        "items": {"data": [{"current_period_end": (NOW + renew_in_days * DAY) // 1000}]},
        "customer": {"id": "cus_1", "invoice_settings": {}},
        "discounts": [{"start": (NOW - 10 * DAY) // 1000, "end": None,
                       "source": {"coupon": {"id": "co_1", "name": "Zenod tester", "percent_off": 100,
                                             "duration": duration}},
                       "promotion_code": {"code": code}}],
    }


def build(root: Path):
    z, p = root / "z", root / "p"
    for d in (z / "t-ana", z / "t-comp", p):
        d.mkdir(parents=True)
    (z / "customer-accounts.json").write_text(json.dumps({
        "cs_pending": {"account_id": "acc-ana", "user_id": "usr_ana", "subscription_status": "checkout_pending",
                       "tenant_id": None, "claimed_at": "2026-10-01T00:00:00Z"},
        "cs_ana": {"account_id": "acc-ana", "user_id": "usr_ana", "subscription_status": "active",
                   "tenant_id": "t-ana", "claimed_at": "2026-10-02T00:00:00Z",
                   "checkout_completed_at": "2026-10-02T00:01:00Z", "stripe_subscription_id": "sub_ana"},
        "cs_comp": {"account_id": "acc-comp", "user_id": "usr_comp", "subscription_status": "active",
                    "tenant_id": "t-comp", "claimed_at": "2026-07-10T00:00:00Z", "github_id": 1},
        "cs_old": {"account_id": "acc-old", "user_id": "usr_old", "subscription_status": "canceled",
                   "tenant_id": "t-old", "claimed_at": "2026-07-10T00:00:00Z"},
    }))
    (z / "customer-identities.json").write_text(json.dumps({"identities": [
        {"user_id": "usr_ana", "provider": "google", "provider_subject": "1234567890", "email": "ana@example.com",
         "created_at": "2026-10-02T00:00:00Z"},
        {"user_id": "usr_comp", "provider": "github", "provider_subject": "1", "email": "op@example.com",
         "created_at": "2026-07-10T00:00:00Z"}]}))
    c = sqlite3.connect(z / "zenod-phylax-adapter.sqlite")
    c.execute("CREATE TABLE zenod_phylax_bindings (account_id TEXT, phylax_tenant_id TEXT, state TEXT, period_id TEXT)")
    c.executemany("INSERT INTO zenod_phylax_bindings VALUES (?,?,?,?)",
                  [("acc-ana", "p-ana", "active", "per-ana"), ("acc-comp", "p-comp", "active", "per-comp")])
    c.commit()
    for t, rows in (("t-ana", [(NOW - DAY, 0.5, None, "succeeded"), (NOW - DAY, 0.3, 0.1, "succeeded"),
                               (NOW - DAY, 9.0, None, "failed"), (NOW - 40 * DAY, 5.0, None, "succeeded")]),
                    ("t-comp", [])):
        c = sqlite3.connect(z / t / "usage.sqlite")
        c.execute("CREATE TABLE llm_usage (ts INTEGER, cost_usd REAL, provider_cost_usd REAL, status TEXT)")
        c.executemany("INSERT INTO llm_usage VALUES (?,?,?,?)", rows)
        c.commit()
    c = sqlite3.connect(z / "t-ana" / "tasks.sqlite")
    c.execute("CREATE TABLE task_jobs (id TEXT, kind TEXT, input_json TEXT, status TEXT, result_json TEXT, error TEXT,"
              " created_at INTEGER, updated_at INTEGER)")
    c.executemany("INSERT INTO task_jobs VALUES (?,?,?,?,?,?,?,?)", [
        ("1", "store", "{}", "done", "{}", None, NOW - 2 * DAY, NOW - 2 * DAY),
        ("2", "media_ingest", "{}", "done", "{}", None, NOW - 3600_000, NOW - 3600_000),
        ("3", "store", '{"source":"selftest"}', "done", "{}", None, NOW - 60_000, NOW - 60_000),
        ("4", "media_ingest", "{}", "error", None, "Google OAuth refresh failed https://x.example/y secret", NOW - 3600_000, NOW - 3600_000),
        ("5", "chat", "{}", "done", '{"reply":"You have used this month\'s AI allowance"}', None, NOW - 60_000, NOW - 60_000),
    ])
    c.commit()
    (p / "phylax-tenant-settings.json").write_text(json.dumps({
        "p-ana": {"phoneNumber": "+34600000000", "verified": True},
        "p-comp": {"phoneNumber": "+34600000001", "verified": False}}))
    c = sqlite3.connect(p / "phylax-capture-jobs.sqlite")
    c.execute("CREATE TABLE phylax_capture_jobs (tenant_id TEXT, tool TEXT, state TEXT, receipt_text TEXT,"
              " delivered_at INTEGER, created_at INTEGER, updated_at INTEGER)")
    c.executemany("INSERT INTO phylax_capture_jobs VALUES (?,?,?,?,?,?,?)", [
        ("p-ana", "ingest_memory", "done", "Saved ✓\nRecap", NOW - 3600_000, NOW - 3700_000, NOW - 3600_000),
        ("p-ana", "store_memory", "done", "Saved.", NOW - 10 * DAY, NOW - 10 * DAY, NOW - 10 * DAY),
        ("p-ana", "chat_with_zenod", "done", "Hi!", NOW - 60_000, NOW - 60_000, NOW - 60_000),
        ("p-ana", "ingest_memory", "error", "⚠️ Zenod could not finish saving", None, NOW - 2 * DAY, NOW - 2 * DAY),
    ])
    c.commit()
    c = sqlite3.connect(p / "phylax-allowance.sqlite")
    c.execute("CREATE TABLE phylax_allowance_period_totals (tenant_id TEXT, period_id TEXT, used_units INTEGER,"
              " allocated_units INTEGER)")
    c.execute("CREATE TABLE phylax_paid_work (tenant_id TEXT, pause_reason TEXT, updated_at INTEGER)")
    c.executemany("INSERT INTO phylax_allowance_period_totals VALUES (?,?,?,?)",
                  [("p-ana", "per-ana", 850_000, 900_000), ("p-ana", "old", 5, 5)])
    c.commit()
    return z, p


ENV = {"ZENOD_PHYLAX_ALLOWANCE_UNITS": "1000000", "ZENOD_PHYLAX_COMPED_ACCOUNT_IDS": "acc-comp"}


class Collect(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.z, self.p = build(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def run_collect(self, env=ENV, testers=None, stripe=None, logs=()):
        stripe = stripe or FakeStripe({"sub_ana": sub()})
        return tw.collect(self.z, self.p, env, stripe, testers, NOW, 24, list(logs))

    def test_all_mode_one_row_per_live_account(self):
        rows, problems = self.run_collect()
        self.assertEqual(problems, [])
        self.assertEqual(sorted(r["label"] for r in rows), ["comped", "t-ana"])  # canceled + pending dropped
        ana = next(r for r in rows if r["label"] == "t-ana")
        self.assertEqual(ana["provider"], "google")
        self.assertEqual(ana["google_id"], "1234567890")
        self.assertEqual(ana["stripe"]["status"], "active")
        self.assertEqual(ana["stripe"]["promotion_code"], "TESTER-ANA")
        self.assertFalse(ana["stripe"]["card_on_file"])
        self.assertEqual(ana["stripe"]["next_invoice_cents"], 0)
        self.assertEqual(ana["whatsapp"], {"binding": "active", "phone": "verified"})
        comp = next(r for r in rows if r["label"] == "comped")
        self.assertEqual(comp["whatsapp"]["phone"], "pending")
        self.assertIsNone(comp["stripe"])

    def test_saves_usage_and_errors(self):
        ana = next(r for r in self.run_collect()[0] if r["label"] == "t-ana")
        self.assertEqual(ana["saves"]["saved_replies_7d"], 1)  # chat reply and 10-day-old save excluded
        self.assertEqual(ana["saves"]["last_saved_reply"], tw.iso(NOW - 3600_000))
        self.assertEqual(ana["saves"]["captures_7d"], 2)  # selftest excluded
        # runtime.ts sum: provider cost wins, failed and last-month excluded: 0.5 + 0.1
        self.assertAlmostEqual(ana["usage"]["ai_usd_mtd"], 0.6)
        self.assertIsNone(ana["usage"]["ai_cap_usd"])
        self.assertIsNone(ana["usage"]["ai_pct"])
        self.assertEqual(ana["usage"]["phylax_pct"], 85.0)
        e = ana["errors"]
        self.assertEqual(e["failed_captures_7d"], 2)  # tasks error + phylax error
        self.assertEqual(e["failed_captures_window"], 1)
        self.assertEqual(e["cap_hits_window"], 1)
        self.assertNotIn("http", " ".join(e["samples"]))

    def test_ai_cap_and_logs(self):
        env = {**ENV, "ZENOD_TENANT_MONTHLY_ALLOWANCE_USD": "0.5"}
        logs = ["[llm.allowance.exceeded] tenant=t-ana month_to_date_usd=0.6 allowance_usd=0.5 mode=enforce",
                "[zenod-phylax] payment_past_due notice failed for account acc-ana: x"]
        ana = next(r for r in self.run_collect(env=env, logs=logs)[0] if r["label"] == "t-ana")
        self.assertEqual(ana["usage"]["ai_pct"], 120.0)
        self.assertEqual(ana["errors"]["cap_hits_window"], 2)
        self.assertEqual(ana["errors"]["notice_failures_window"], 1)

    def test_testers_file_matches_by_code_email_and_reports_unredeemed(self):
        stripe = FakeStripe({"sub_ana": sub()}, codes={"TESTER-BOB": {"code": "TESTER-BOB", "active": True,
                                                                        "times_redeemed": 0, "expires_at": None}})
        testers = tw.parse_testers("label\tcode\tpromotion_code\tcreated\texpires\n"
                                   "Ana\tTESTER-ANA\tpromo_1\t2026-10-01\t2026-10-15\nOp, op@example.com\nBob,TESTER-BOB\n")
        rows, _ = self.run_collect(testers=testers, stripe=stripe)
        self.assertEqual([r["label"] for r in rows], ["Ana", "Op", "Bob"])
        self.assertEqual(rows[0]["account_id"], "acc-ana")
        self.assertEqual(rows[1]["account_id"], "acc-comp")
        self.assertIsNone(rows[2]["account_id"])
        self.assertEqual(rows[2]["code"]["times_redeemed"], 0)
        rows, _ = self.run_collect(testers=tw.parse_testers("Zed\tNOPE"), stripe=stripe)
        self.assertEqual(rows[0]["code"], {"error": "code not found in Stripe"})

    def test_stripe_failure_is_a_problem_not_a_crash(self):
        class Broken(FakeStripe):
            def subscription(self, sid):
                raise RuntimeError("HTTP 500 on subscriptions")
        rows, problems = self.run_collect(stripe=Broken({}))
        self.assertEqual(problems, ["stripe read failed for acc-ana"])
        self.assertIn("stripe read failed", " ".join(tw.alerts_for(rows[0] if rows[0]["label"] == "t-ana" else rows[1], NOW, 5, 80)))


FLOW = {"paused": False, "testers": [
    # Applied on zenod.dev/testers, got a Stripe one-time code, signed up with it (like the T7 account).
    {"id": "t1", "email": "ana.applied@gmail.com", "appliedAt": "2026-10-20T00:00:00Z", "status": "accepted",
     "code": "TESTER-ANA", "codeSource": "stripe"},
    {"id": "t2", "email": "bob@gmail.com", "appliedAt": "2026-10-21T00:00:00Z", "status": "accepted",
     "code": "ZT-BOBBOBBO", "codeSource": "local"},
    {"id": "t3", "email": "carla@gmail.com", "appliedAt": "2026-10-22T00:00:00Z", "status": "waitlist"},
    {"id": "t4", "email": "operations+t7@alpha9.io", "appliedAt": "2026-10-19T00:00:00Z", "status": "accepted",
     "code": "TESTER-OPS", "codeSource": "stripe"},
]}


class Flow(unittest.TestCase):
    """T7-F2: testers who apply through zenod.dev/testers, read from Zenod's tester-flow.json."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.z, self.p = build(Path(self.tmp.name))
        (self.z / "tester-flow.json").write_text(json.dumps(FLOW))
        self.stripe = FakeStripe({"sub_ana": sub()}, codes={"TESTER-OPS": {"code": "TESTER-OPS", "active": True,
                                                                           "times_redeemed": 0, "expires_at": None}})

    def tearDown(self):
        self.tmp.cleanup()

    def collect(self, testers=None, env=ENV):
        return tw.collect(self.z, self.p, env, self.stripe, testers, NOW, 24, [], tw.read_flow(self.z, env))

    def test_no_flow_file_is_none(self):
        (self.z / "tester-flow.json").unlink()
        self.assertIsNone(tw.read_flow(self.z, ENV))

    def test_applicants_listed_with_the_same_checks(self):
        rows, problems = self.collect()
        self.assertEqual(problems, [])
        self.assertEqual([r["label"] for r in rows],
                         ["operations+t7@alpha9.io", "ana.applied@gmail.com", "bob@gmail.com", "carla@gmail.com"])
        ops, ana, bob, carla = rows
        # Matched through the Stripe promotion code on the subscription, though the emails differ.
        self.assertEqual(ana["account_id"], "acc-ana")
        self.assertEqual(ana["source"], "apply")
        self.assertEqual(ana["stripe"]["status"], "active")
        self.assertEqual(ana["usage"]["phylax_pct"], 85.0)
        self.assertEqual(ana["saves"]["captures_7d"], 2)
        self.assertIn("Phylax units 85.0% of allowance", tw.alerts_for(ana, NOW, 5, 80))
        self.assertTrue(ops["flow"]["test"])
        self.assertFalse(ana["flow"]["test"])
        self.assertEqual(ops["code"]["times_redeemed"], 0)
        self.assertEqual(bob["code"], {"code": "ZT-BOBBOBBO", "source": "local", "redeemed": False})
        self.assertEqual(carla["signup"], "waitlist")
        out = tw.table(rows, NOW)
        self.assertIn("operations+t7@alpha9.io (apply, test)", out)
        self.assertIn("ana.applied@gmail.com (apply)", out)
        self.assertIn("Zenod code, redeemed=no", out)
        self.assertIn("waitlist", out)

    def test_local_code_matches_the_redeeming_account(self):
        flow = json.loads(json.dumps(FLOW))
        flow["testers"][1]["redeemedBy"] = "acc-comp"
        (self.z / "tester-flow.json").write_text(json.dumps(flow))
        bob = next(r for r in self.collect()[0] if r["label"] == "bob@gmail.com")
        self.assertEqual(bob["account_id"], "acc-comp")

    def test_ledger_kept_and_not_doubled(self):
        rows, _ = self.collect(testers=tw.parse_testers("Ana\tTESTER-ANA\nZed\tNOPE"))
        labels = [r["label"] for r in rows]
        self.assertEqual(labels[:2], ["Ana", "Zed"])
        self.assertNotIn("ana.applied@gmail.com", labels)  # same account: one row, marked from both
        self.assertEqual(rows[0]["source"], "ledger+apply")
        self.assertIn("Ana (ledger, apply)", tw.table(rows, NOW))
        self.assertEqual(len(rows), 5)

    def test_operator_mark_wins_over_rule(self):
        (self.z / "tester-marks.json").write_text(json.dumps({"marks": {"operations+t7@alpha9.io": "real",
                                                                         "bob@gmail.com": "test"}}))
        rows = {r["label"]: r for r in self.collect()[0]}
        self.assertFalse(rows["operations+t7@alpha9.io"]["flow"]["test"])
        self.assertTrue(rows["bob@gmail.com"]["flow"]["test"])
        rows = {r["label"]: r for r in self.collect(env={**ENV, "ZENOD_TEAM_EMAILS": "Carla@gmail.com"})[0]}
        self.assertTrue(rows["carla@gmail.com"]["flow"]["test"])

    def test_redact_hides_applicant_emails_and_codes(self):
        flow = json.loads(json.dumps(FLOW))
        flow["testers"][1]["redeemedBy"] = "user-usr_450335af676221c44d2d4394"
        (self.z / "tester-flow.json").write_text(json.dumps(flow))
        rows = tw.redact(self.collect()[0])
        out = json.dumps(rows) + tw.table(rows, NOW)
        for leak in ("ana.applied", "gmail.com", "operations+t7", "alpha9.io", "TESTER-", "ZT-BOB",
                     "450335af676221c4", "ana@example.com"):
            self.assertNotIn(leak, out)
        self.assertIn("o***@a*** (apply, test)", out)

    def test_bad_flow_file_does_not_crash(self):
        self.assertEqual(tw.parse_flow("{not json"), [])
        self.assertEqual(tw.parse_flow(""), [])

    def test_rule_matches_testermarks_ts(self):
        src = (HERE.parents[1] / "packages/server/src/testerMarks.ts").read_text()
        for d in tw.TEST_DOMAINS:
            self.assertIn(f'"{d}"', src)
        self.assertIn("(test|invalid|example|localhost)", src)
        self.assertIn('TESTER_MARKS_FILE = "tester-marks.json"', src)
        self.assertIn('TESTER_FLOW_FILE = "tester-flow.json"',
                      (HERE.parents[1] / "packages/server/src/testerFlow.ts").read_text())


class Alerts(unittest.TestCase):
    def row(self, **over):
        r = {"account_id": "a", "local_status": "active",
             "stripe": {"status": "active", "renews_at_ms": NOW + 20 * DAY, "next_invoice_cents": 0, "currency": "eur"},
             "usage": {"ai_pct": None, "phylax_pct": 1.0},
             "errors": {"window_hours": 24, "failed_captures_window": 0, "cap_hits_window": 0, "notice_failures_window": 0}}
        for k, v in over.items():
            r[k] = {**r[k], **v} if isinstance(v, dict) and isinstance(r.get(k), dict) else v
        return r

    def test_quiet(self):
        self.assertEqual(tw.alerts_for(self.row(), NOW, 5, 80), [])

    def test_past_due(self):
        self.assertEqual(tw.alerts_for(self.row(stripe={"status": "past_due"}), NOW, 5, 80), ["subscription past_due"])

    def test_renewal_without_extension(self):
        r = self.row(stripe={"renews_at_ms": NOW + 3 * DAY, "next_invoice_cents": 900})
        self.assertEqual(len(tw.alerts_for(r, NOW, 5, 80)), 1)
        self.assertIn("apply the month extension", tw.alerts_for(r, NOW, 5, 80)[0])
        # Extension applied: next invoice is 0, no alert. Renewal further out: no alert.
        self.assertEqual(tw.alerts_for(self.row(stripe={"renews_at_ms": NOW + 3 * DAY}), NOW, 5, 80), [])
        self.assertEqual(tw.alerts_for(self.row(stripe={"next_invoice_cents": 900}), NOW, 5, 80), [])
        # Preview unreadable inside the window: alert (cannot prove the extension).
        self.assertTrue(tw.alerts_for(self.row(stripe={"renews_at_ms": NOW + DAY, "next_invoice_cents": None}), NOW, 5, 80))

    def test_planned_end_is_quiet(self):
        # EPIC-26 S5: the month-end job ended an inactive tester's free month on purpose.
        ended = self.row(local_status="canceled", stripe={"status": "canceled", "month_end": "ended_inactive"})
        self.assertEqual(tw.alerts_for(ended, NOW, 5, 80), [])
        self.assertEqual(len(tw.alerts_for(self.row(local_status="canceled", stripe={"status": "canceled"}), NOW, 5, 80)), 2)
        ending = self.row(stripe={"renews_at_ms": NOW + 3 * DAY, "next_invoice_cents": 900, "cancel_at_period_end": True,
                                  "month_end": "ended_inactive"})
        self.assertEqual(tw.alerts_for(ending, NOW, 5, 80), [])

    def test_caps_and_failures(self):
        a = tw.alerts_for(self.row(usage={"ai_pct": 80.0, "phylax_pct": 79.9},
                                   errors={"failed_captures_window": 2, "cap_hits_window": 1}), NOW, 5, 80)
        self.assertEqual(len(a), 3, a)


class Helpers(unittest.TestCase):
    def test_parse_testers_json(self):
        self.assertEqual(tw.parse_testers('{"Ana": "C1"}'), [{"label": "Ana", "tokens": ["C1"]}])
        self.assertEqual(tw.parse_testers('[{"label": "Ana", "code": "C1", "email": "a@x"}]'),
                         [{"label": "Ana", "tokens": ["C1", "a@x"]}])

    def test_month_start(self):
        self.assertEqual(tw.iso(tw.month_start_ms(NOW)), "2026-10-01T00:00:00Z")

    def test_redact_leaves_no_email_code_or_full_ids(self):
        rows = [{"label": "Ana", "is_label_from_file": True, "account_id": "user-usr_450335af676221c44d2d4394",
                 "tenant_id": "user-usr_450335af676221c44d2d4394", "user_id": "usr_450335af676221c44d2d4394",
                 "email": "ana@example.com", "google_id": "1234567890",
                 "stripe": {"promotion_code": "TESTER-ANA", "discounts": [{"coupon": "ZENOD_X", "promotion_code": "TESTER-ANA"}]}}]
        out = json.dumps(tw.redact(rows))
        for leak in ("ana@example.com", "TESTER-ANA", "1234567890", "450335af676221c4", "ZENOD_X", '"Ana"'):
            self.assertNotIn(leak, out)

    def test_runtime_spend_sql_matches(self):
        src = (HERE.parents[1] / "packages/server/src/usageStore.ts").read_text()
        self.assertIn("SUM(COALESCE(provider_cost_usd, cost_usd))", src)
        self.assertRegex(src, r"WHERE ts >= \? AND status = 'succeeded'")

    def test_capture_kinds_match_t25_index(self):
        src = (HERE.parents[1] / "packages/server/src/taskJobStore.ts").read_text()
        m = re.search(r"kind IN \(([^)]*)\)\s*\n\s*AND COALESCE\(json_extract\(input_json, '\$.source'\), ''\) <> 'selftest'", src)
        self.assertIsNotNone(m)
        self.assertEqual(tuple(x.strip().strip("'") for x in m.group(1).split(",")), tw.CAPTURE_KINDS)


if __name__ == "__main__":
    unittest.main()
