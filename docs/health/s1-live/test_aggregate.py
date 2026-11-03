#!/usr/bin/env python3
"""EPIC-6 S2: tests for the aggregator's status rules, persisted last errors and transitions.

    python3 docs/health/s1-live/test_aggregate.py
"""

import copy
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aggregate as A  # noqa: E402

T0 = "2026-11-03T12:00:00Z"


def raw(at=T0):
    """A probe where everything is healthy (the watchdog delivers, the runner apps are idle)."""
    ms = A.parse_ts(at).timestamp() * 1000
    return {
        "probedAt": at,
        "site": {"status": 200, "secs": 0.2, "title": "Zenod — memory"},
        "cloud": {"status": 200, "secs": 0.1, "json": {"status": "ok", "sha": "abc1234def",
                                                         "eventLoop": {"p99Ms": 20, "utilization": 0.1}}},
        "phylax": {"status": 200, "secs": 0.1, "json": {
            "status": "ok", "sha": "1707c9f", "channels": {"whatsapp": {"state": "connected",
                                                                        "receivePath": {"status": "ready"}}},
            "worker": {"lastHeartbeatAt": ms - 5000}, "restart": {"required": False}}},
        "observatory": {"status": 200, "secs": 0.1},
        "publish": {"headSha": "abc1234def", "createdAt": "2026-11-03T10:00:00Z"},
        "vps1": {
            "at": at,
            "containers": {A.ZENOD_SVC: {"restarts": 0, "startedAt": "2026-11-02T21:22:32Z", "running": True}},
            "dokploy": {"zenod-mt": [{"status": "done", "image": "ghcr.io/zenod-ai/zenod:sha-abc1234"}],
                        "phylax": [{"status": "done", "image": "x@sha256:c48fd494c365aaaa"}],
                        **{n: [{"status": "idle", "image": "-"}] for n in A.RUNNER_APPS}},
            "zenod_log": {"lastJob": {"at": "2026-11-03T11:50:00Z", "kind": "store"}, "jobs24h": 3,
                          "lastIndex": {"at": "2026-11-03T11:00:00Z", "ms": 20.0, "rows": 10},
                          "lastError": None, "errors24h": 0},
            "phylax_log": {"lastInbound": "2026-11-03T11:40:00Z", "inbound24h": 1, "lastReconnect": None,
                           "reconnects24h": 0, "lastError": None, "errors24h": 0},
            "access": {h: {"lastReal": "2026-11-03T11:59:00Z", "real24h": 5, "last5xx": None, "status5xx": None,
                           "n5xx24h": 0} for h in ("zenod.dev", "cloud.zenod.dev", "phylax.zenod.dev")},
            "deploy_poller": {"at": A.iso(A.parse_ts(at) - A.dt.timedelta(minutes=2)),
                              "msg": "deploy-poller zenod-mt: noop"},
            "deploy_last_roll": {"at": "2026-11-02T21:22:00Z", "msg": "deploy-poller zenod-mt: rolled"},
            "watchdog": {"alerts24h": 1, "deliveredNo24h": 0, "deliveredYes24h": 1, "lastAlert": "2026-11-03T09:00:00Z",
                         "deadTargets": [], "timer": "active"},
            "readiness": {"at": "2026-11-03T11:30:00Z", "ready": True, "issues": "[]",
                          "proofs": [{"id": "backup_restore", "daysLeft": 20, "expiresAt": "2026-11-23T00:00:00Z"}]},
            "keeper_last": {"at": "2026-11-03T03:00:00Z", "msg": "plan ok"},
            "accounts": {"generatedAt": at, "count": 4, "lastSavedReply": "2026-11-03T11:41:00Z",
                         "lastCapture": "2026-11-03T11:41:00Z", "saves7d": 3, "captures7d": 3, "failedCaptures7d": 0,
                         "capHits24h": 0, "noticeFailures24h": 0, "bindings": {"active": 2}},
            "testers": {"count": 5, "signedUp": 0, "alerts": 0, "problems": 0},
            "cloudflared": "active",
            "disk_root_pct": 50,
            "disk_guard": {"at": "2026-11-03T11:55:00Z", "msg": "ok"},
        },
    }


def status(d):
    return {c["id"]: c["status"] for c in A.components(d)}


class StatusRules(unittest.TestCase):
    def test_healthy_probe_is_green_and_runner_grey(self):
        s = status(raw())
        self.assertEqual(s.pop("agent_runner"), "grey")
        self.assertEqual(set(s.values()), {"green"}, s)
        self.assertEqual(len(A.components(raw())), 12)

    def test_cloud_down_is_red(self):
        d = raw(); d["cloud"] = {"status": 503, "secs": 1, "json": {}}
        self.assertEqual(status(d)["cloud"], "red")

    def test_cloud_slow_event_loop_is_amber(self):
        d = raw(); d["cloud"]["json"]["eventLoop"]["p99Ms"] = 450
        self.assertEqual(status(d)["cloud"], "amber")

    def test_cloud_behind_published_sha_amber_only_after_30_min(self):
        d = raw(); d["publish"] = {"headSha": "fff0000", "createdAt": "2026-11-03T11:50:00Z"}
        self.assertEqual(status(d)["cloud"], "green")
        d["publish"]["createdAt"] = "2026-11-03T11:00:00Z"
        self.assertEqual(status(d)["cloud"], "amber")

    def test_site_wrong_title_is_red(self):
        d = raw(); d["site"]["title"] = "502 Bad Gateway"
        self.assertEqual(status(d)["site"], "red")

    def test_phylax_disconnected_red_stale_heartbeat_amber(self):
        d = raw(); d["phylax"]["json"]["channels"]["whatsapp"]["state"] = "connecting"
        self.assertEqual(status(d)["phylax"], "red")
        d = raw(); d["phylax"]["json"]["worker"]["lastHeartbeatAt"] -= 120_000
        self.assertEqual(status(d)["phylax"], "amber")

    def test_backup_drill_expired_red_expiring_amber(self):
        d = raw(); d["vps1"]["readiness"]["proofs"][0]["daysLeft"] = 0
        self.assertEqual(status(d)["database"], "red")
        d["vps1"]["readiness"]["proofs"][0]["daysLeft"] = 5
        self.assertEqual(status(d)["database"], "amber")
        self.assertEqual(status(d)["readiness"], "amber")

    def test_watchdog_undelivered_is_red(self):
        d = raw(); w = d["vps1"]["watchdog"]
        w.update(deliveredNo24h=144, deliveredYes24h=0, deadTargets=["https://c1.zenod.dev/api/health"])
        c = next(x for x in A.components(d) if x["id"] == "watchdog")
        self.assertEqual(c["status"], "red")
        self.assertIn("c1.zenod.dev", c["problem"])

    def test_watchdog_timer_stopped_is_red(self):
        d = raw(); d["vps1"]["watchdog"]["timer"] = "inactive"
        self.assertEqual(status(d)["watchdog"], "red")

    def test_deploy_poller_silent_red_stale_amber(self):
        d = raw(); d["vps1"]["deploy_poller"] = None
        self.assertEqual(status(d)["deploy"], "red")
        d["vps1"]["deploy_poller"] = {"at": "2026-11-03T11:30:00Z", "msg": "deploy-poller zenod-mt: noop"}
        self.assertEqual(status(d)["deploy"], "amber")

    def test_disk_levels(self):
        d = raw(); d["vps1"]["disk_root_pct"] = 85
        self.assertEqual(status(d)["host"], "amber")
        d["vps1"]["disk_root_pct"] = 95
        self.assertEqual(status(d)["host"], "red")

    def test_tunnel_down_red_and_runner_running_amber(self):
        d = raw(); d["vps1"]["cloudflared"] = "failed"
        d["vps1"]["dokploy"]["ring"] = [{"status": "running", "image": "-"}]
        s = status(d)
        self.assertEqual(s["ingress"], "red")
        self.assertEqual(s["agent_runner"], "amber")

    def test_vps1_probe_failed_makes_remote_rows_amber_not_green(self):
        d = raw(); d["vps1"] = {"error": "ssh/remote probe failed"}
        s = status(d)
        self.assertEqual(s["watchdog"], "amber")        # would read as green with no data
        self.assertEqual(s["database"], "amber")
        self.assertEqual(s["cloud"], "green")           # its own health endpoint still answers
        self.assertEqual(s["site"], "green")

    def test_no_message_text_or_secrets_fields(self):
        doc, _ = A.aggregate(raw(), A.load_state("/nonexistent"))
        blob = json.dumps(doc["components"])
        for word in ("body_text", "transcript_text", "input_json", "result_json", "token", "password"):
            self.assertNotIn(word, blob)


class History(unittest.TestCase):
    def run_once(self, d, st):
        return A.aggregate(d, st)

    def test_last_error_survives_a_redeploy(self):
        st = A.load_state("/nonexistent")
        d = raw()
        d["vps1"]["phylax_log"]["lastReconnect"] = {"at": "2026-11-03T00:13:57Z", "reason": "WhatsApp disconnected (428)"}
        d["vps1"]["zenod_log"]["lastError"] = {"at": "2026-11-03T10:00:00Z", "what": "db busy"}
        _, st = self.run_once(d, st)
        # redeploy: docker stdout is reset, the sources no longer report those errors or the last job
        d2 = raw("2026-11-03T12:05:00Z")
        d2["vps1"]["zenod_log"].update(lastJob=None, lastError=None)
        doc, st = self.run_once(d2, st)
        c = {x["id"]: x for x in doc["components"]}
        self.assertEqual(c["phylax"]["last_error"]["at"], "2026-11-03T00:13:57Z")
        self.assertIn("428", c["phylax"]["last_error"]["what"])
        self.assertEqual(c["cloud"]["last_error"]["what"], "db busy")
        self.assertEqual(c["cloud"]["last_activity"]["at"], "2026-11-03T11:50:00Z")
        self.assertTrue(c["cloud"]["last_activity"]["from_history"])
        self.assertNotIn(" ago)", c["cloud"]["last_activity"]["what"])

    def test_state_round_trips_through_a_file(self):
        with tempfile.TemporaryDirectory() as td:
            p = os.path.join(td, "sub", "h.json")
            d = raw(); d["vps1"]["zenod_log"]["lastError"] = {"at": "2026-11-03T10:00:00Z", "what": "db busy"}
            _, st = A.aggregate(d, A.load_state(p))
            A.save_state(st, p)
            self.assertEqual(os.stat(p).st_mode & 0o777, 0o600)
            doc, _ = A.aggregate(raw("2026-11-03T12:05:00Z"), A.load_state(p))
            self.assertEqual(doc["components"][1]["last_error"]["what"], "db busy")

    def test_repeated_error_updates_time_without_duplicates(self):
        st = A.load_state("/nonexistent")
        d = raw(); d["vps1"]["watchdog"].update(deliveredNo24h=3, deliveredYes24h=0)
        _, st = A.aggregate(d, st)
        d2 = copy.deepcopy(d); d2["probedAt"] = d2["vps1"]["at"] = "2026-11-03T12:05:00Z"
        doc, st = A.aggregate(d2, st)
        w = next(x for x in doc["components"] if x["id"] == "watchdog")
        self.assertEqual(w["last_error"]["first_seen"], T0)
        self.assertEqual(w["last_error"]["at"], "2026-11-03T12:05:00Z")
        self.assertEqual(len(w["errors"]), 1)

    def test_new_error_replaces_and_old_kept_in_list(self):
        st = A.load_state("/nonexistent")
        d = raw(); d["vps1"]["zenod_log"]["lastError"] = {"at": "2026-11-03T10:00:00Z", "what": "db busy"}
        _, st = A.aggregate(d, st)
        d["vps1"]["zenod_log"]["lastError"] = {"at": "2026-11-03T11:00:00Z", "what": "timeout"}
        doc, st = A.aggregate(d, st)
        c = doc["components"][1]
        self.assertEqual(c["last_error"]["what"], "timeout")
        self.assertEqual([e["what"] for e in c["errors"]], ["timeout", "db busy"])


class Transitions(unittest.TestCase):
    def test_red_then_green_gives_two_alert_transitions(self):
        st = A.load_state("/nonexistent")
        doc, st = A.aggregate(raw(), st)
        self.assertEqual(doc["transitions"], [])                       # first run is the baseline
        d = raw("2026-11-03T12:05:00Z"); d["cloud"] = {"status": 503, "secs": 1, "json": {}}
        doc, st = A.aggregate(d, st)
        doc, st = A.aggregate(raw("2026-11-03T12:10:00Z"), st)
        t = doc["transitions"]
        self.assertEqual([(x["component"], x["from"], x["to"], x["alert"]) for x in t],
                         [("cloud", "green", "red", True), ("cloud", "red", "green", True)])
        self.assertEqual(t[0]["at"], "2026-11-03T12:05:00Z")
        self.assertIn("503", t[0]["reason"])
        self.assertEqual(A.transitions_after(doc, "2026-11-03T12:05:00Z"), [t[1]])

    def test_amber_is_recorded_but_not_alerted(self):
        st = A.load_state("/nonexistent")
        _, st = A.aggregate(raw(), st)
        d = raw("2026-11-03T12:05:00Z"); d["vps1"]["disk_root_pct"] = 85
        doc, st = A.aggregate(d, st)
        self.assertEqual(len(doc["transitions"]), 1)
        self.assertFalse(doc["transitions"][0]["alert"])
        self.assertEqual(A.transitions_after(doc, alert_only=True), [])

    def test_cli_reads_a_published_document(self):
        st = A.load_state("/nonexistent")
        _, st = A.aggregate(raw(), st)
        d = raw("2026-11-03T12:05:00Z"); d["vps1"]["cloudflared"] = "failed"
        doc, _ = A.aggregate(d, st)
        with tempfile.TemporaryDirectory() as td:
            p = os.path.join(td, "probe.json")
            with open(p, "w") as f:
                json.dump(doc, f)
            buf = io.StringIO()
            with redirect_stdout(buf):
                self.assertEqual(A.main(["transitions", "--doc", p, "--alert-only"]), 0)
            lines = [json.loads(x) for x in buf.getvalue().splitlines()]
            self.assertEqual([(x["component"], x["to"]) for x in lines], [("ingress", "red")])
            buf = io.StringIO()
            with redirect_stdout(buf):
                A.main(["transitions", "--doc", p, "--after", "2026-11-03T12:05:00Z"])
            self.assertEqual(buf.getvalue(), "")
            buf = io.StringIO()
            with redirect_stdout(buf):
                A.main(["status", "--doc", p])
            self.assertIn("ingress       red", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
