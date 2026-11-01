#!/usr/bin/env python3
"""Unit tests for keeper.py pure logic. Run: python3 scripts/readiness-keeper/keeper.test.py"""
import datetime as dt
import importlib.util
import re
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("keeper", HERE / "keeper.py")
keeper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(keeper)

UTC = dt.timezone.utc
ENV = {
    "ZENOD_PUBLIC_GOOGLE_SIGNUP": "1",
    "ZENOD_BACKUP_RESTORE_VERIFIED_AT": "2026-10-31T23:23:49Z",
    "ZENOD_STRIPE_PROFILE_VERIFIED_AT": "2026-09-15T22:06:51.545470+00:00",
    "ZENOD_GOOGLE_DRIVE_VAULT_OAUTH_VERIFIED_AT": "2026-08-30T15:48:22Z",
}


class Windows(unittest.TestCase):
    def test_windows_match_production_readiness_ts(self):
        src = (HERE.parents[1] / "packages/server/src/productionReadiness.ts").read_text()
        for cid, key, days, _ in keeper.DATED_CHECKS:
            m = re.search(r'isRecentIsoDate\(env\.' + key + r', now, (\d+)\)', src)
            self.assertIsNotNone(m, key)
            self.assertEqual(int(m.group(1)), days, cid)
            self.assertIn(f'id: "{cid}"', src)
        m = re.search(r"ADVISORY_CHECKS = new Set\(\[(.*?)\]\)", src, re.S)
        self.assertEqual(set(re.findall(r'"(\w+)"', m.group(1))), keeper.ADVISORY)


class Env(unittest.TestCase):
    def test_set_env_lines_replaces_only_named_key(self):
        text = "A=1\n# c=3\nZENOD_BACKUP_RESTORE_VERIFIED_AT=old\nB=x=y\n"
        out = keeper.set_env_lines(text, {"ZENOD_BACKUP_RESTORE_VERIFIED_AT": "new"})
        self.assertEqual(out, "A=1\n# c=3\nZENOD_BACKUP_RESTORE_VERIFIED_AT=new\nB=x=y\n")

    def test_set_env_lines_appends_missing(self):
        self.assertEqual(keeper.set_env_lines("A=1", {"K": "v"}), "A=1\nK=v")

    def test_parse_iso_variants(self):
        self.assertEqual(keeper.parse_iso("2026-10-31T23:23:49Z"), dt.datetime(2026, 10, 31, 23, 23, 49, tzinfo=UTC))
        self.assertIsNotNone(keeper.parse_iso("2026-09-15T22:06:51.545470+00:00"))
        self.assertIsNone(keeper.parse_iso("garbage"))
        self.assertIsNone(keeper.parse_iso(None))


class Proofs(unittest.TestCase):
    def test_expiries(self):
        now = dt.datetime(2026, 11, 1, tzinfo=UTC)
        p = {x["id"]: x for x in keeper.proof_status(ENV, now)}
        self.assertEqual(p["backup_restore"]["expiresAt"], "2026-12-01T23:23:49Z")
        self.assertEqual(p["google_drive_vault_oauth"]["expiresAt"], "2026-11-28T15:48:22Z")
        self.assertEqual(p["stripe_profile"]["expiresAt"], "2026-12-14T22:06:51Z")

    def test_drive_check_only_with_public_google_signup(self):
        env = {**ENV, "ZENOD_PUBLIC_GOOGLE_SIGNUP": "0"}
        ids = [x["id"] for x in keeper.proof_status(env, dt.datetime(2026, 11, 1, tzinfo=UTC))]
        self.assertNotIn("google_drive_vault_oauth", ids)

    def test_due_gate(self):
        now = dt.datetime(2026, 11, 20, tzinfo=UTC)
        p = {x["id"]: x for x in keeper.proof_status(ENV, now)}
        self.assertFalse(keeper.due(p["backup_restore"], 24))    # 19 days old
        self.assertTrue(keeper.due(p["stripe_profile"], 60))     # 65 days old
        self.assertTrue(keeper.due(None, 24))
        later = {x["id"]: x for x in keeper.proof_status(ENV, dt.datetime(2026, 11, 25, tzinfo=UTC))}
        self.assertTrue(keeper.due(later["backup_restore"], 24))


class Watch(unittest.TestCase):
    def test_issues_seven_days_and_closed(self):
        now = dt.datetime(2026, 11, 25, tzinfo=UTC)
        proofs = keeper.proof_status(ENV, now)
        ready = {"ready": False, "checks": [{"id": "backup_restore", "ok": False}, {"id": "stripe_webhook", "ok": False}]}
        keys = {k: lvl for k, lvl, _ in keeper.watch_issues(ready, None, proofs, None, 7)}
        self.assertEqual(keys["checkout-closed"], "ALERT")
        self.assertEqual(keys["expiry-backup_restore"], "WARN")          # 6.98 d left
        self.assertEqual(keys["expiry-google_drive_vault_oauth"], "WARN")  # 3.6 d left
        self.assertNotIn("expiry-stripe_profile", keys)                 # 19.9 d left
        text = dict((k, t) for k, _, t in keeper.watch_issues(ready, None, proofs, None, 7))["checkout-closed"]
        self.assertIn("backup_restore", text)
        self.assertNotIn("stripe_webhook", text)

    def test_expired_is_alert(self):
        proofs = keeper.proof_status(ENV, dt.datetime(2026, 11, 29, tzinfo=UTC))
        keys = {k: lvl for k, lvl, _ in keeper.watch_issues({"ready": True}, None, proofs, None, 7)}
        self.assertEqual(keys["expiry-google_drive_vault_oauth"], "ALERT")

    def test_healthy_is_quiet(self):
        proofs = keeper.proof_status(ENV, dt.datetime(2026, 11, 1, tzinfo=UTC))
        self.assertEqual(keeper.watch_issues({"ready": True}, None, proofs, None, 7), [])

    def test_dedupe_realert_and_recovered(self):
        issues = [("k", "WARN", "t")]
        m1, s1 = keeper.plan_alerts(issues, {}, 1000, 3600)
        self.assertEqual([x[0] for x in m1], ["WARN"])
        m2, s2 = keeper.plan_alerts(issues, s1, 2000, 3600)
        self.assertEqual(m2, [])
        m3, s3 = keeper.plan_alerts(issues, s2, 4700, 3600)
        self.assertEqual([x[0] for x in m3], ["WARN"])
        m4, _ = keeper.plan_alerts([("k", "ALERT", "t")], s3, 4800, 3600)   # escalation re-alerts
        self.assertEqual([x[0] for x in m4], ["ALERT"])
        m5, s5 = keeper.plan_alerts([], s3, 5000, 3600)
        self.assertEqual([x[0] for x in m5], ["RECOVERED"])
        self.assertEqual(s5, {})

    def test_queue_alert_atomic_file_contract(self):
        with tempfile.TemporaryDirectory() as d:
            name = keeper.queue_alert(Path(d), "WARN", "hello", dry=False)
            files = list(Path(d).iterdir())
            self.assertEqual([f.name for f in files], [name])
            self.assertRegex(name, r"^\d+-\d{9}-WARN\.msg$")
            self.assertEqual(files[0].read_text(), "[WARN] hello\n")
            self.assertEqual(keeper.queue_alert(Path(d) / "missing", "WARN", "x", dry=False), "no-dir")
            self.assertEqual(keeper.queue_alert(Path(d), "WARN", "x", dry=True), "dry")
            self.assertEqual(len(list(Path(d).iterdir())), 1)


class Prune(unittest.TestCase):
    def test_keeps_newest_keeper_dirs_only(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for n in ("keeper-20261101T000000Z", "keeper-20261201T000000Z", "keeper-20270101T000000Z",
                      "epic7-t0-20261031", "pre-587c005-20261010"):
                (root / n).mkdir()
            gone = keeper.prune_local(root, 2)
            self.assertEqual([Path(g).name for g in gone], ["keeper-20261101T000000Z"])
            self.assertEqual(sorted(p.name for p in root.iterdir()),
                             ["epic7-t0-20261031", "keeper-20261201T000000Z", "keeper-20270101T000000Z",
                              "pre-587c005-20261010"])


if __name__ == "__main__":
    unittest.main()
