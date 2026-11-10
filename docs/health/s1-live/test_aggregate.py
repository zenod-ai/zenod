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
        "cloud": {"status": 200, "secs": 0.1, "json": {
            "status": "ok", "sha": "abc1234def", "eventLoop": {"p99Ms": 20, "utilization": 0.1},
            "background": {"provider": "deepseek", "state": "ok", "balanceUsd": 40.0, "checkedAt": at},
            "credit": {"openrouter": {"state": "ok", "limitUsd": 100, "remainingUsd": 60.0, "usageDailyUsd": 1.0,
                                      "usageWeeklyUsd": 7.0, "checkedAt": at}}}},
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
                         "lastDelivered": "2026-11-03T09:00:00Z", "lastRun": at,
                         "timer": "active", "retiredRootTimer": "inactive"},
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
        self.assertEqual(len(A.components(raw())), 20)   # 12 parts + 6 EPIC-24 M2 alert rows + E26-S8 AI credit + E26-S5 testers

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
        w.update(deliveredNo24h=2, deliveredYes24h=5)       # S5: any alert not sent by the HQ relay in 10 min
        c = next(x for x in A.components(d) if x["id"] == "watchdog")
        self.assertEqual(c["status"], "red")
        self.assertIn("2 alerts not delivered", c["problem"])

    def test_watchdog_not_run_in_10_min_is_red_retired_root_timer_noted(self):
        d = raw(); w = d["vps1"]["watchdog"]
        w["retiredRootTimer"] = "active"
        c = next(x for x in A.components(d) if x["id"] == "watchdog")
        self.assertEqual(c["status"], "green")
        self.assertIn("retired root timer", c["error"])
        w["lastRun"] = "2026-11-03T11:40:00Z"
        self.assertEqual(status(d)["watchdog"], "red")

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

    def test_reply_stall_turns_phylax_red_after_an_hour(self):
        # ZAL-A8: 2026-11-04 to 11-06, messages came in and no "Saved" reply went out for 45 h, unalerted
        d = raw()
        d["vps1"]["accounts"]["lastSavedReply"] = "2026-11-03T09:00:00Z"
        d["vps1"]["phylax_log"]["inboundTimes"] = ["2026-11-03T08:59:00Z", "2026-11-03T10:30:00Z",
                                                   "2026-11-03T11:55:00Z"]
        c = next(x for x in A.components(d) if x["id"] == "phylax")
        self.assertEqual(c["status"], "red")
        self.assertIn("no “Saved” reply since a WhatsApp message at 2026-11-03 10:30:00 UTC", c["problem"])
        d["vps1"]["phylax_log"]["inboundTimes"] = ["2026-11-03T11:30:00Z"]  # under an hour: still green
        self.assertEqual(status(d)["phylax"], "green")
        d["vps1"]["accounts"]["lastSavedReply"] = "2026-11-03T11:31:00Z"
        d["vps1"]["phylax_log"]["inboundTimes"] = ["2026-11-03T10:30:00Z", "2026-11-03T11:30:00Z"]
        self.assertEqual(status(d)["phylax"], "green")  # replied after every message

    def test_a_question_answered_by_chat_is_not_a_reply_stall(self):
        # ZAL-A12: the 2026-11-08 18:50Z WhatsApp question got its chat answer at 18:50:22Z and no "Saved" (none due)
        d = raw()
        d["vps1"]["accounts"]["lastSavedReply"] = "2026-11-03T09:00:00Z"
        d["vps1"]["phylax_log"]["inboundTimes"] = ["2026-11-03T10:30:00Z"]
        d["vps1"]["zenod_log"]["chatReplies"] = ["2026-11-03T10:30:22Z"]
        self.assertEqual(status(d)["phylax"], "green")
        d["vps1"]["zenod_log"]["chatReplies"] = ["2026-11-03T10:40:00Z"]  # a later, unrelated chat (web app)
        self.assertEqual(status(d)["phylax"], "red")

    def test_saves_failing_for_an_hour_turn_database_red(self):
        d = raw()
        d["vps1"]["zenod_log"]["capturesFailingSince"] = "2026-11-03T11:20:00Z"
        self.assertEqual(status(d)["database"], "green")
        d["vps1"]["zenod_log"]["capturesFailingSince"] = "2026-11-03T10:50:00Z"
        c = next(x for x in A.components(d) if x["id"] == "database")
        self.assertEqual(c["status"], "red")
        self.assertIn("saves failing since 2026-11-03 10:50:00 UTC", c["problem"])

    def test_tester_alert_is_red_with_its_line_read_problem_amber(self):
        d = raw()
        d["vps1"]["testers"].update(alerts=1, alertLines=["t1…: renews in 3.0 d with next invoice 9.00 EUR: apply the month extension"])
        c = next(x for x in A.components(d) if x["id"] == "tester_watch")
        self.assertEqual(c["status"], "red")
        self.assertIn("apply the month extension", c["problem"])
        d["vps1"]["testers"].update(alerts=0, alertLines=[], problems=1)
        self.assertEqual(status(d)["tester_watch"], "amber")

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


def smoke(at=T0, fail=None, simulated=False):
    """A zenod-smoke/v1 latest.json: site and cloud checks, `fail` = {check id: reason} failing."""
    fail = fail or {}
    checks = [{"id": i, "component": comp, "title": t, "ok": i not in fail, "reason": fail.get(i, "200"),
               **({"overridden": True} if simulated and i in fail else {})}
              for i, comp, t in (("site.home", "site", "Home page answers"), ("site.connect", "site", "Connect page"),
                                 ("cloud.health", "cloud", "Health answers ok"))]
    return {"schema": "zenod-smoke/v1", "startedAt": at, "simulated": simulated, "checks": checks}


class SmokeMerge(unittest.TestCase):
    """S4: probe status × smoke result → row status (the merge rule)."""

    REF = A.parse_ts(T0)

    def m(self, status, problem=None, sm=None, cid="site"):
        return A.merge_smoke(status, problem, A.smoke_summary(sm) if sm else None, cid, self.REF)

    def test_rule_table(self):
        bad = smoke(fail={"site.home": "timeout after 15 s"})
        good = smoke()
        old = smoke(at="2026-11-03T11:00:00Z", fail={"site.home": "timeout"})
        cases = [  # (probe status, probe problem, smoke, expected row status)
            ("green", None, None, "green"), ("amber", "slow", None, "amber"), ("red", "down", None, "red"),
            ("green", None, good, "green"), ("amber", "slow", good, "amber"), ("red", "down", good, "red"),
            ("green", None, bad, "red"), ("amber", "slow", bad, "red"), ("red", "down", bad, "red"),
            ("grey", None, bad, "grey"), ("green", None, old, "green"), ("amber", "slow", old, "amber")]
        for st, pr, sm, want in cases:
            with self.subTest(probe=st, smoke=sm and A.smoke_summary(sm)["components"]["site"]["ok"]):
                self.assertEqual(self.m(st, pr, sm)[0], want)

    def test_reason_shown(self):
        st, pr, cell = self.m("green", None, smoke(fail={"site.home": "HTTP 503"}))
        self.assertEqual(pr, "smoke check failed: Home page answers: HTTP 503")
        self.assertEqual(cell["reason"], pr)
        self.assertFalse(cell["ok"])
        st, pr, _ = self.m("amber", "event loop slow", smoke(fail={"site.home": "HTTP 503"}))
        self.assertEqual(pr, "event loop slow; smoke check failed: Home page answers: HTTP 503")

    def test_test_run_labelled(self):
        _, pr, cell = self.m("green", None, smoke(fail={"site.home": "ENOTFOUND"}, simulated=True))
        self.assertIn("[test run: check pointed at a test target]", pr)
        self.assertTrue(cell["simulated"])

    def test_component_without_checks_untouched(self):
        self.assertEqual(self.m("green", None, smoke(fail={"site.home": "x"}), cid="database"), ("green", None, None))

    def test_stale_marked(self):
        _, _, cell = self.m("green", None, smoke(at="2026-11-03T11:00:00Z", fail={"site.home": "x"}))
        self.assertTrue(cell["stale"])


class SmokeThroughAggregate(unittest.TestCase):
    """S4 end to end in the aggregator: transitions (what S5 sends), last error and the recorded status."""

    def run_(self, st, at, sm, mut=None):
        r = raw(at)
        if mut:
            mut(r)
        r["smoke"] = A.smoke_summary(sm)
        return A.aggregate(r, st)

    def row(self, doc, cid):
        return next(c for c in doc["components"] if c["id"] == cid)

    def test_red_then_green_one_alert_each(self):
        st = A.load_state("/nonexistent")
        d, st = self.run_(st, "2026-11-03T12:00:00Z", smoke("2026-11-03T12:00:00Z"))
        self.assertEqual(self.row(d, "site")["status"], "green")
        d, st = self.run_(st, "2026-11-03T12:15:00Z", smoke("2026-11-03T12:15:00Z", fail={"site.home": "HTTP 503"}))
        site = self.row(d, "site")
        self.assertEqual((site["status"], site["probe_status"]), ("red", "green"))
        self.assertEqual(site["last_error"]["source"], "smoke: red")
        self.assertIn("HTTP 503", site["last_error"]["what"])
        # probe sees the same outage 5 min later: still one red transition, one alert
        def down(r):
            r["site"]["status"] = 503
        d, st = self.run_(st, "2026-11-03T12:20:00Z", smoke("2026-11-03T12:15:00Z", fail={"site.home": "HTTP 503"}), down)
        d, st = self.run_(st, "2026-11-03T12:30:00Z", smoke("2026-11-03T12:30:00Z"))
        ts = [(t["component"], t["from"], t["to"], t["alert"]) for t in A.transitions_after(d, alert_only=True)]
        self.assertEqual(ts, [("site", "green", "red", True), ("site", "red", "green", True)])
        self.assertEqual(self.row(d, "site")["status"], "green")

    def test_no_smoke_in_raw_is_s2_behaviour(self):
        d, _ = A.aggregate(raw(), A.load_state("/nonexistent"))
        self.assertTrue(all(c["smoke"] is None for c in d["components"]))
        self.assertEqual(d["summary"]["red"], 0)


class NewestPublish(unittest.TestCase):
    """2026-11-03: the API's 1-run page returned a September run, so the cloud row went falsely amber."""

    RUNS = [{"headSha": "779f74c8210b", "createdAt": "2026-09-07T04:06:06Z"},
            {"headSha": "58563d9aaaaa", "createdAt": "2026-11-03T18:22:22Z"},
            {"headSha": "d3fa4b9aaaaa", "createdAt": "2026-11-03T17:04:00Z"}]

    def test_picks_newest_by_created_at_not_api_order(self):
        self.assertEqual(A.newest_publish(self.RUNS)["headSha"], "58563d9aaaaa")

    def test_empty_or_broken_runs(self):
        self.assertIsNone(A.newest_publish([]))
        self.assertIsNone(A.newest_publish(None))
        self.assertIsNone(A.newest_publish([{"headSha": "x"}]))

    def test_cloud_green_when_live_sha_is_the_newest_publish(self):
        r = raw("2026-11-03T20:30:20Z")
        r["cloud"]["json"]["sha"] = "58563d9aaaaa"
        r["publish"] = A.newest_publish(self.RUNS)
        cloud = next(c for c in A.components(r) if c["id"] == "cloud")
        self.assertEqual(cloud["status"], "green")
        self.assertNotIn("behind", cloud["signal"])


class ChatRepliesSurviveRotation(unittest.TestCase):
    def test_chat_replies_survive_log_rotation(self):
        """ZAL-A15: an answered WhatsApp question stays answered after its `done: chat` log line is gone."""
        st = {"components": {}, "transitions": [], "since": None}
        raw1 = {"probedAt": "2026-11-08T18:55:00Z", "vps1": {"zenod_log": {"chatReplies": ["2026-11-08T18:50:22Z"]}}}
        A.remember_chat_replies(raw1, st, A.parse_ts(raw1["probedAt"]))
        raw2 = {"probedAt": "2026-11-09T06:00:00Z", "vps1": {"zenod_log": {"chatReplies": []}}}
        merged = A.remember_chat_replies(raw2, st, A.parse_ts(raw2["probedAt"]))
        self.assertEqual(merged["vps1"]["zenod_log"]["chatReplies"], ["2026-11-08T18:50:22Z"])
        self.assertEqual(raw2["vps1"]["zenod_log"]["chatReplies"], [])
        self.assertIsNone(A.reply_stall(["2026-11-08T18:50:09Z"], "2026-11-08T16:14:05Z", A.parse_ts(raw2["probedAt"]),
                                        chat_replies=merged["vps1"]["zenod_log"]["chatReplies"]))
        old = {"probedAt": "2026-11-20T00:00:00Z", "vps1": {"zenod_log": {"chatReplies": []}}}
        self.assertEqual(A.remember_chat_replies(old, st, A.parse_ts(old["probedAt"]))["vps1"]["zenod_log"]["chatReplies"], [])


class AlertRows(unittest.TestCase):
    """EPIC-24 M2: rows 13-18 turn red within one run of a failure a person would notice, and clear after 15 min."""

    def doc(self, ops=(), at="2026-11-03T12:00:00Z", **vps1):
        r = raw(at)
        r["vps1"]["zenod_log"]["ops"] = [list(x) for x in ops]
        r["vps1"].update(vps1)
        return {c["id"]: c for c in A.components(r)}

    def test_all_green_when_nothing_failed(self):
        d = self.doc()
        for cid in ("alert_saves", "alert_replies", "alert_answers", "alert_signins", "alert_app", "alert_helpers",
                    "alert_testers"):
            self.assertEqual(d[cid]["status"], "green", cid)

    def test_each_kind_turns_its_own_row_red_then_clears(self):
        for kind, cid in (("save", "alert_saves"), ("answer", "alert_answers"), ("signin", "alert_signins"),
                          ("app", "alert_app"), ("helper", "alert_helpers"),
                          ("tester", "alert_testers")):
            fresh = self.doc([("2026-11-03T11:57:00Z", kind, "x_failed")])
            self.assertEqual(fresh[cid]["status"], "red", cid)
            self.assertIn("1 ", fresh[cid]["problem"])
            others = [k for k, c in fresh.items() if k.startswith("alert_") and k != cid and c["status"] == "red"]
            self.assertEqual(others, [], cid)
            old = self.doc([("2026-11-03T11:44:00Z", kind, "x_failed")])
            self.assertEqual(old[cid]["status"], "green", cid)
            self.assertIn("1 in 24 h", old[cid]["signal"])

    def test_a_drill_says_so(self):
        d = self.doc([("2026-11-03T11:58:00Z", "signin", "drill_staged")])
        self.assertIn("[drill: staged fault]", d["alert_signins"]["problem"])
        d = self.doc([("2026-11-03T11:58:00Z", "reply", "drill_staged")])
        self.assertEqual(d["alert_replies"]["status"], "red")

    def test_a_5xx_from_the_access_log_is_an_app_error(self):
        r = raw()
        r["vps1"]["zenod_log"]["ops"] = []
        r["vps1"]["access"]["cloud.zenod.dev"]["app5xx"] = ["2026-11-03T11:55:00Z"]
        d = {c["id"]: c for c in A.components(r)}
        self.assertEqual(d["alert_app"]["status"], "red")
        self.assertIn("http_5xx 1", d["alert_app"]["problem"])

    def test_a_whatsapp_message_with_no_reply_for_15_min(self):
        r = raw()
        r["vps1"]["phylax_log"]["inboundTimes"] = ["2026-11-03T11:44:00Z"]
        r["vps1"]["accounts"]["lastSavedReply"] = "2026-11-03T11:00:00Z"
        d = {c["id"]: c for c in A.components(r)}
        self.assertEqual(d["alert_replies"]["status"], "red")
        self.assertEqual(d["phylax"]["status"], "green")          # the 60 min rule has not fired yet
        r["vps1"]["accounts"]["lastSavedReply"] = "2026-11-03T11:45:00Z"
        d = {c["id"]: c for c in A.components(r)}
        self.assertEqual(d["alert_replies"]["status"], "green")

    def test_one_alert_then_one_recovery_through_transitions(self):
        st = A.load_state("/nonexistent")
        seen = []
        for at, ops in (("2026-11-03T11:55:00Z", []), ("2026-11-03T12:00:00Z", [("2026-11-03T11:58:00Z", "save", "stuck")]),
                        ("2026-11-03T12:05:00Z", [("2026-11-03T11:58:00Z", "save", "stuck")]),
                        ("2026-11-03T12:15:00Z", [("2026-11-03T11:58:00Z", "save", "stuck")])):
            r = raw(at)
            r["vps1"]["zenod_log"]["ops"] = [list(x) for x in ops]
            doc, st = A.aggregate(r, st)
            seen += [(t["component"], t["to"]) for t in doc["transitions"] if t["at"] == at and t["alert"]]
        self.assertEqual([x for x in seen if x[0] == "alert_saves"], [("alert_saves", "red"), ("alert_saves", "green")])


class Credit(unittest.TestCase):
    """E26-S8: the AI credit row goes red days before DeepSeek or OpenRouter runs out, names who tops up, and a
    staged low balance fires once and clears."""

    def run_at(self, at, ds=None, orx=None, ops=(), phylax_ops=(), state=None):
        r = raw(at)
        j = r["cloud"]["json"]
        if ds is not None:
            j["background"]["balanceUsd"] = ds
        if orx is not None:
            j["credit"]["openrouter"].update(orx)
        r["vps1"]["zenod_log"]["ops"] = [list(x) for x in ops]
        r["vps1"]["phylax_log"]["ops"] = [list(x) for x in phylax_ops]
        doc, st = A.aggregate(r, state or {"components": {}, "transitions": [], "since": None})
        return {c["id"]: c for c in doc["components"]}["credit"], st, doc

    def feed(self, balances, step_h=1.0, start="2026-11-03T00:00:00Z"):
        """One run per step with these DeepSeek balances; returns the last row and state."""
        st, t = None, A.parse_ts(start)
        for b in balances:
            row, st, _ = self.run_at(A.iso(t), ds=b, state=st)
            t += A.dt.timedelta(hours=step_h)
        return row, st, t

    def test_green_with_plenty_left(self):
        row, _, _ = self.run_at(T0)
        self.assertEqual(row["status"], "green")
        self.assertIn("OpenRouter: $60.00 left, about 60.0 days left at $1.00 a day", row["signal"])
        self.assertIn("DeepSeek: $40.00 left, daily spend not known yet", row["signal"])

    def test_days_left_turns_it_red_above_the_fixed_line(self):
        # $2 an hour = $48 a day; $30 left is well above $5 yet under a day of spend
        row, _, _ = self.feed([40, 38, 36, 34, 32, 30, 28, 26])
        self.assertEqual(row["status"], "red")
        self.assertIn("DeepSeek: $26.00 left, about 0.5 days left at $48.00 a day", row["problem"])
        self.assertIn("Jordi tops up at https://platform.deepseek.com/top_up", row["problem"])

    def test_a_top_up_is_not_spend(self):
        row, _, _ = self.feed([20, 19.9, 19.8, 60, 59.9, 59.8, 59.7, 59.6])
        self.assertEqual(row["status"], "green")
        self.assertAlmostEqual(row["signal_value"]["deepseek"]["perDayUsd"], 0.6 / 7 * 24, places=3)

    def test_slow_spend_stays_green_until_the_days_run_low(self):
        row, _, _ = self.feed([9.4, 9.39, 9.38, 9.37, 9.36, 9.35, 9.34])
        self.assertEqual(row["status"], "green")          # $0.24 a day: about 39 days
        row, _, _ = self.run_at(T0, ds=4.0)
        self.assertEqual(row["status"], "amber")          # spend unknown: the $5 line still warns

    def test_openrouter_key_low_on_days(self):
        row, _, _ = self.run_at(T0, orx={"remainingUsd": 6.0, "usageWeeklyUsd": 14.0})
        self.assertEqual(row["status"], "red")
        self.assertIn("OpenRouter: $6.00 left, about 3.0 days left at $2.00 a day", row["problem"])
        self.assertIn("https://openrouter.ai/settings/credits", row["problem"])

    def test_a_credit_refusal_in_the_logs_is_red_even_with_an_unlimited_key(self):
        unl = {"state": "unlimited", "limitUsd": None, "remainingUsd": None}
        row, _, _ = self.run_at(T0, orx=unl)
        self.assertEqual(row["status"], "green")
        row, _, _ = self.run_at(T0, orx=unl, phylax_ops=[("2026-11-03T10:00:00Z", "credit", "openrouter_402")])
        self.assertEqual(row["status"], "red")
        self.assertIn("OpenRouter refused 1 calls for credit", row["problem"])
        row, _, _ = self.run_at(T0, orx=unl, phylax_ops=[("2026-11-03T05:00:00Z", "credit", "openrouter_402")])
        self.assertEqual(row["status"], "green")         # older than 6 h

    def test_a_staged_low_balance_alerts_once_and_clears(self):
        st = None
        seen = []
        for minute, ops in ((0, ()), (5, [("2026-11-03T12:04:00Z", "credit", "drill_staged")]),
                            (10, [("2026-11-03T12:04:00Z", "credit", "drill_staged")]),
                            (25, [("2026-11-03T12:04:00Z", "credit", "drill_staged")])):
            at = A.iso(A.parse_ts(T0) + A.dt.timedelta(minutes=minute))
            row, st, doc = self.run_at(at, ops=ops, state=st)
            seen.append(row["status"])
        self.assertEqual(seen, ["green", "red", "red", "green"])
        alerts = [t for t in doc["transitions"] if t["component"] == "credit" and t["alert"]]
        self.assertEqual([(t["from"], t["to"]) for t in alerts], [("green", "red"), ("red", "green")])
        self.assertIn("[drill: staged low balance]", alerts[0]["reason"])
        self.assertIn("DeepSeek: $1.00 left", alerts[0]["reason"])
        self.assertIn("Jordi tops up", alerts[0]["reason"])
        self.assertTrue(all(b != 1.0 for _, b in st["credit"]["deepseek"]))   # the staged balance is never sampled


if __name__ == "__main__":
    unittest.main()

