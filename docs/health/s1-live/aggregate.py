#!/usr/bin/env python3
"""EPIC-6 S2 health aggregator: turns one raw probe (probe.py collect()) into one JSON document.

Pure and stdlib only, so it runs anywhere (VPS3 timer, tests, VPS1 for S5). One document per run:

    {"schema": "zenod-health/v1", "checked_at", "summary": {green, amber, red, grey},
     "components": [{id, n, name, where, status, signal, signal_value, checked_at, last_activity,
                     last_error, errors, source, tests, link?}],
     "transitions": [{component, name, from, to, at, reason, alert}],   # newest last, last 50 kept
     "history_since", "raw"}

status is green / amber / red, or grey (not deployed, never alerted). last_error and last_activity come from
a persisted state file (STATE), not just from the sources, because docker stdout resets on every deploy: a
component's last error survives a redeploy of that component. last_error = {at (newest occurrence), first_seen,
what, source}; `errors` keeps the last 10 distinct ones. Values are counts, states, timestamps and short event
names only (no message text, ids or keys), the same as the S1 page.

Interface for S5 (the sender), on any host that has the published document:

    python3 aggregate.py transitions --doc probe.json [--after ISO] [--alert-only]   # JSON lines, oldest first
    python3 aggregate.py status --doc probe.json                                      # one line per component
    import aggregate; aggregate.transitions_after(doc, after_iso, alert_only=True)

A transition has alert=true when it goes to red or comes back from red (red then green is E6-3). S5 keeps its own
cursor (the `at` of the last transition it sent); the document is rewritten every 5 min and keeps 50 transitions.

S4: the S3 smoke battery's latest result rides in raw["smoke"] (smoke_summary()) and merge_smoke() folds it into each
row's status before transitions are computed, so a failed smoke check turns its row red, shows its reason, lands in
the 7-day strip and goes through the same S5 sender and row key as a probe red: one outage seen by both alerts once.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.request

UTC = dt.timezone.utc
SCHEMA = "zenod-health/v1"
STATE = os.path.expanduser("~/.local/state/zenod-health/history.json")
KEEP_ERRORS, KEEP_TRANSITIONS, DOC_TRANSITIONS = 10, 200, 50
ZENOD_SVC = "zenod-mt-fxpzoo"
RUNNER_APPS = ("epaminon", "callisthenes", "ring", "herald", "zenod-cloud-test")
STATUSES = ("green", "amber", "red", "grey")
SMOKE_STALE_SECS = 45 * 60   # three missed 15-min runs: an old smoke result no longer colours a row


def iso(t: dt.datetime | None) -> str | None:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if t else None


def parse_ts(s: str | None) -> dt.datetime | None:
    if not s or not isinstance(s, str):
        return None
    m = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?(Z|[+-]\d\d:?\d\d)?", s.strip())
    if not m:
        return None
    base = dt.datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S")
    tz = m.group(3) or "Z"
    if tz == "Z":
        return base.replace(tzinfo=UTC)
    sign = 1 if tz[0] == "+" else -1
    hh, mm = int(tz[1:3]), int(tz[-2:])
    return (base - sign * dt.timedelta(hours=hh, minutes=mm)).replace(tzinfo=UTC)


def ago(s: str | dt.datetime | None, ref: dt.datetime) -> str:
    t = parse_ts(s) if isinstance(s, str) else s
    if not t:
        return "none seen"
    sec = max((ref - t).total_seconds(), 0)
    if sec < 120:
        a = f"{int(sec)} s ago"
    elif sec < 7200:
        a = f"{int(sec // 60)} min ago"
    elif sec < 172800:
        a = f"{sec / 3600:.1f} h ago"
    else:
        a = f"{sec / 86400:.1f} days ago"
    return f"{iso(t).replace('T', ' ').replace('Z', ' UTC')} ({a})"


AGO = re.compile(r" \([\d.]+ (s|min|h|days) ago\)")


def ev(at: str | None, what: str, source: str) -> dict | None:
    """One timestamped error event reported by a source (log line, 5xx, drop)."""
    return {"at": at, "what": what, "source": source} if at else None


# --------------------------------------------------------------------------------------------- status rules

def components(d: dict) -> list[dict]:
    """The status rules: one dict per component from a raw probe. Pure: depends only on `d`.

    Each component carries status, signal (text) and signal_value (numbers), activity (text) and
    activity_at, error (current detail text), events (timestamped errors from sources) and problem
    (why it is not green, recorded as a probe-observed error)."""
    ref = parse_ts(d["probedAt"])
    v = d.get("vps1") or {}
    remote_ok = "error" not in v and bool(v.get("at"))
    remote_at = v.get("at") or d["probedAt"]
    acc = v.get("access") or {}
    dk = v.get("dokploy") or {}
    R: list[dict] = []

    def row(**k):
        k.setdefault("events", [])
        k.setdefault("problem", None)
        k.setdefault("activity_at", None)
        k.setdefault("checked_at", remote_at if k.get("remote", True) else d["probedAt"])
        if k.get("remote", True) and not remote_ok and k["status"] != "grey":
            k["status"] = "amber"
            k["problem"] = "VPS1 probe failed: this row cannot be checked"
        if k["status"] in ("amber", "red") and not k["problem"]:
            k["problem"] = k.get("error") or "not green"
        k["events"] = [e for e in k["events"] if e]
        R.append(k)

    # 1 site
    site = d.get("site") or {}
    ok = site.get("status") == 200 and site.get("title") and "Zenod" in site["title"]
    a = acc.get("zenod.dev") or {}
    row(id="site", n="1", name="Marketing site zenod.dev", remote=False,
        where="VPS1 · Dokploy app zenod-mt, same container as the cloud app",
        status="green" if ok else "red",
        problem=None if ok else f"GET https://zenod.dev/ → {site.get('status')}",
        signal=f"GET https://zenod.dev/ → {site.get('status')} in {site.get('secs')} s, title “{site.get('title')}”",
        signal_value={"http": site.get("status"), "secs": site.get("secs")},
        activity=f"last page request {ago(a.get('lastReal'), ref)}; {a.get('real24h', '?')} requests in 24 h (bots included)",
        activity_at=a.get("lastReal"),
        error=(f"last 5xx {ago(a.get('last5xx'), ref)} ({a.get('status5xx')}); {a.get('n5xx24h')} in 24 h"
               if a.get("last5xx") else "no 5xx in the retained access log"),
        events=[ev(a.get("last5xx"), f"HTTP {a.get('status5xx')} on zenod.dev", "traefik access log")],
        source="GET https://zenod.dev/ from VPS3; Traefik access log on VPS1",
        tests="npm test (server static-surface tests, CI)")

    # 2 cloud
    c = d.get("cloud") or {}
    j = c.get("json") or {}
    el = j.get("eventLoop") or {}
    sha = (j.get("sha") or "")[:7]
    pub = ((d.get("publish") or {}).get("headSha") or "")[:7]
    col, notes, prob = "green", [], None
    if c.get("status") != 200 or j.get("status") != "ok":
        col, prob = "red", f"/api/health → {c.get('status')} “{j.get('status')}”"
    elif (el.get("p99Ms") or 0) > 200 or (el.get("utilization") or 0) > 0.8:
        col, prob = "amber", "event loop slow"
        notes.append("event loop slow")
    if pub and sha and pub != sha:
        pt = parse_ts((d.get("publish") or {}).get("createdAt"))
        if pt and (ref - pt).total_seconds() > 1800 and col == "green":
            col, prob = "amber", f"live sha {sha} is behind the newest published image {pub} for over 30 min"
        notes.append(f"newest published image is {pub}")
    zl = v.get("zenod_log") or {}
    zc = (v.get("containers") or {}).get(ZENOD_SVC) or {}
    cz = acc.get("cloud.zenod.dev") or {}
    row(id="cloud", n="2", name="Cloud app cloud.zenod.dev", remote=False,
        where="VPS1 · zenod-mt, image " + ", ".join(x["image"].split("/")[-1] for x in dk.get("zenod-mt", [])),
        status=col, problem=prob,
        signal=(f"/api/health → {c.get('status')} “{j.get('status')}”, sha {sha} "
                f"({'matches' if sha == pub else 'vs'} last publish {pub or '?'}), p99 {el.get('p99Ms')} ms, "
                f"load {el.get('utilization')}; container up since {ago(zc.get('startedAt'), ref)}, "
                f"{zc.get('restarts', '?')} restarts" + ("; " + "; ".join(notes) if notes else "")),
        signal_value={"http": c.get("status"), "sha": sha, "published": pub, "p99Ms": el.get("p99Ms"),
                      "utilization": el.get("utilization"), "restarts": zc.get("restarts"),
                      "startedAt": zc.get("startedAt")},
        activity=(f"last finished job {ago((zl.get('lastJob') or {}).get('at'), ref)} "
                  f"({(zl.get('lastJob') or {}).get('kind', '-')}); {zl.get('jobs24h', 0)} jobs in 24 h"),
        activity_at=(zl.get("lastJob") or {}).get("at"),
        error="; ".join([
            (f"last error log line {ago(zl['lastError']['at'], ref)} ({zl['lastError']['what']})"
             if zl.get("lastError") else "no error log lines since the container started"),
            (f"last 5xx {ago(cz['last5xx'], ref)}" if cz.get("last5xx") else "no 5xx in access log")]),
        events=[ev((zl.get("lastError") or {}).get("at"), (zl.get("lastError") or {}).get("what", ""), "container log"),
                ev(cz.get("last5xx"), f"HTTP {cz.get('status5xx')} on cloud.zenod.dev", "traefik access log")],
        source="GET /api/health from VPS3; zenod-mt container log and Traefik access log on VPS1",
        tests="packages/server/test/health.test.ts, eventLoopHealth.test.ts, productionReadiness.test.ts (CI on every push)")

    # 3 database / ledgers
    ac = v.get("accounts") or {}
    rd = v.get("readiness") or {}
    proofs = rd.get("proofs") or []
    bk = next((p for p in proofs if p["id"] == "backup_restore"), None)
    b = ac.get("bindings") or {}
    unavail = sum(n for k, n in b.items() if k != "active")
    col, prob = "green", None
    if ac.get("error"):
        col, prob = "red", "tester-watch could not read the ledgers"
    elif bk is None or bk["daysLeft"] <= 0:
        col, prob = "red", "backup restore drill missing or expired"
    elif bk["daysLeft"] <= 7:
        col, prob = "amber", f"backup restore drill expires in {bk['daysLeft']:.0f} days"
    elif ac.get("failedCaptures7d"):
        col, prob = "amber", f"{ac.get('failedCaptures7d')} failed captures in 7 days"
    elif unavail:
        col, prob = "amber", f"{unavail} WhatsApp bindings not active"
    row(id="database", n="3", name="Database and credits ledger",
        where="VPS1 · SQLite files on volumes zenod-mt-data and phylax-data",
        status=col, problem=prob,
        signal=(f"ledgers readable through tester-watch for {ac.get('count', '?')} accounts; "
                f"backup restore drill valid {bk['daysLeft']:.0f} more days (to {bk['expiresAt'][:10]})" if bk else
                "backup proof not found")
               + "; WhatsApp bindings " + ", ".join(f"{k} {n}" for k, n in sorted(b.items())),
        signal_value={"accounts": ac.get("count"), "backupDaysLeft": bk["daysLeft"] if bk else None,
                      "bindings": b},
        activity=f"last capture written {ago(ac.get('lastCapture'), ref)}; {ac.get('captures7d', '?')} captures in 7 days",
        activity_at=ac.get("lastCapture"),
        error=(f"{ac.get('failedCaptures7d', '?')} failed captures in 7 days, {ac.get('capHits24h', '?')} credit-cap hits "
               f"and {ac.get('noticeFailures24h', '?')} failed billing notices in 24 h"),
        source="tester-watch --redact (max timestamps and counts) and the readiness watch journal on VPS1",
        tests="scripts/verify-zenod-data.mjs (on a copy); monthly restore drill by the readiness keeper; keeper.test.py")

    # 4 phylax
    p = d.get("phylax") or {}
    pj = p.get("json") or {}
    wa = (pj.get("channels") or {}).get("whatsapp") or {}
    hb = (pj.get("worker") or {}).get("lastHeartbeatAt")
    hb_age = (ref.timestamp() * 1000 - hb) / 1000 if hb else None
    pl = v.get("phylax_log") or {}
    col, prob = "green", None
    if p.get("status") != 200 or pj.get("status") != "ok" or wa.get("state") != "connected":
        col, prob = "red", f"/api/health → {p.get('status')} “{pj.get('status')}”, WhatsApp {wa.get('state')}"
    elif hb_age is not None and hb_age > 60:
        col, prob = "amber", f"worker heartbeat {hb_age:.0f} s old"
    elif (pj.get("restart") or {}).get("required"):
        col, prob = "amber", "restart required"
    lr = pl.get("lastReconnect") or {}
    row(id="phylax", n="4", name="WhatsApp relay Phylax", remote=False,
        where="VPS1 · Dokploy app phylax, image " + ", ".join(x["image"].split("@")[-1][:19] for x in dk.get("phylax", [])),
        status=col, problem=prob,
        signal=(f"/api/health → {p.get('status')} “{pj.get('status')}”, sha {(pj.get('sha') or '')[:7]}, WhatsApp "
                f"{wa.get('state')}, receive path {(wa.get('receivePath') or {}).get('status')}, worker heartbeat "
                f"{hb_age:.0f} s old" if hb_age is not None else f"/api/health → {p.get('status')}"),
        signal_value={"http": p.get("status"), "whatsapp": wa.get("state"),
                      "heartbeatAgeS": round(hb_age) if hb_age is not None else None},
        activity=(f"last inbound WhatsApp message {ago(pl.get('lastInbound'), ref)} ({pl.get('inbound24h', 0)} in 24 h); "
                  f"last “Saved” reply sent {ago(ac.get('lastSavedReply'), ref)} ({ac.get('saves7d', '?')} in 7 days)"),
        activity_at=max(filter(None, [pl.get("lastInbound"), ac.get("lastSavedReply")]), default=None),
        error="; ".join([
            f"last WhatsApp drop {ago(lr.get('at'), ref)} ({lr.get('reason')}), reconnected; {pl.get('reconnects24h', 0)} drops in 24 h"
            if lr else "no WhatsApp drop since the container started",
            f"last error log line {ago(pl['lastError']['at'], ref)}" if pl.get("lastError") else "0 error log lines"]),
        events=[ev(lr.get("at"), f"WhatsApp drop ({lr.get('reason')}), reconnected", "container log"),
                ev((pl.get("lastError") or {}).get("at"), (pl.get("lastError") or {}).get("what", ""), "container log")],
        source="GET /api/health from VPS3; phylax container log on VPS1",
        tests="phylaxUnit.test.ts (health and restart rules), npm run test:phylax-image-contract (CI)")

    # 5 agent runner
    sts = {n: dk[n][0]["status"] for n in RUNNER_APPS if dk.get(n)}
    running = [n for n, s in sts.items() if s != "idle"]
    row(id="agent_runner", n="5", name="Agent runner",
        where="not deployed · Dokploy apps " + ", ".join(sts) + " are stopped",
        status="grey" if not running else "amber",
        problem=None if not running else "unexpected status: " + ", ".join(f"{n} {sts[n]}" for n in running),
        signal="all idle in Dokploy" if not running else "unexpected status: " + ", ".join(f"{n} {sts[n]}" for n in running),
        signal_value={"apps": sts},
        activity="agents run inside the cloud app, see row 2", error="n/a",
        source="Dokploy wrapper app list on VPS1",
        tests="scripts/exec-smoke.mjs exists but writes to prod, so it is kept out of the read-only battery")

    # 6 memory search index (EPIC-9)
    ix = zl.get("lastIndex") or {}
    row(id="memory_index", n="6", name="Memory search index", where="VPS1 · inside zenod-mt, built on demand per search",
        status="green" if ix else "grey",
        signal=(f"last index load {ix.get('ms')} ms for {ix.get('rows')} items" if ix else
                "no index load logged since the container started"),
        signal_value={"ms": ix.get("ms"), "rows": ix.get("rows")},
        activity=f"last search index load {ago(ix.get('at'), ref)}" if ix else "none since restart",
        activity_at=ix.get("at"), error="see row 2",
        source="zenod-mt container log on VPS1", tests="packages/core/test/memoryIndex.test.ts (CI)")

    # 7 deploy path
    dp = v.get("deploy_poller") or {}
    dr = v.get("deploy_last_roll") or {}
    dpa = (ref - parse_ts(dp["at"])).total_seconds() if dp.get("at") else None
    col = "red" if dpa is None else ("green" if dpa < 600 and ("noop" in dp["msg"] or "roll" in dp["msg"]) else "amber")
    row(id="deploy", n="7", name="Deploy path", where="VPS1 · user timer infra-vps-deploy-poller, every 2 min",
        status=col, problem=None if col == "green" else (dp.get("msg") or "no poller line in 30 min"),
        signal=f"last run {ago(dp.get('at'), ref)}: “{dp.get('msg')}”",
        signal_value={"lastRunAgeS": round(dpa) if dpa is not None else None},
        activity=f"last production roll {ago(dr.get('at'), ref)}" if dr else
        f"no roll in the last 14 days of journal; container started {ago(zc.get('startedAt'), ref)}",
        activity_at=dr.get("at"),
        error="none in the last 30 min" if col == "green" else dp.get("msg", "no poller line in 30 min"),
        source="infra-vps-deploy-poller journal on VPS1",
        tests="infra-vps tests/test_deploy_poller.py; scripts/deploy-fleet.test.mjs for the manual script")

    # 8 alerts: watchdog (S5: user timer on VPS1; every queued alert id must show up as sent by the HQ relay)
    w = v.get("watchdog") or {}
    lra = (ref - parse_ts(w["lastRun"])).total_seconds() if w.get("lastRun") else None
    col = "red" if w.get("timer") != "active" or w.get("deliveredNo24h") or lra is None or lra > 600 else "green"
    row(id="watchdog", n="8", name="Alerts: host watchdog", where="VPS1 · user timer zenod-health-watchdog, every "
        "2 min; red rows here and its own checks go to Jordi's HQ alert thread",
        status=col,
        problem=None if col == "green" else (
            f"watchdog timer {w.get('timer')}" if w.get("timer") != "active" else
            f"{w.get('deliveredNo24h')} alerts not delivered after 10 min" if w.get("deliveredNo24h") else
            "watchdog has not run in 10 min"),
        signal=f"timer {w.get('timer')}, last run {ago(w.get('lastRun'), ref)}; {w.get('alerts24h')} alerts and "
               f"recoveries in 24 h, {w.get('deliveredYes24h')} delivered to the HQ thread, "
               f"{w.get('deliveredNo24h')} not delivered after 10 min",
        signal_value={"alerts24h": w.get("alerts24h"), "delivered24h": w.get("deliveredYes24h"),
                      "undelivered24h": w.get("deliveredNo24h")},
        activity=f"last alert {ago(w.get('lastAlert'), ref)}; last delivered {ago(w.get('lastDelivered'), ref)}",
        activity_at=w.get("lastAlert"),
        error="; ".join(filter(None, [
            "none" if col == "green" else "alerts are not reaching Jordi",
            "the retired root timer zenod-watchdog is still on and sends nowhere (root step to switch it off)"
            if w.get("retiredRootTimer") == "active" else None])),
        source="zenod-alert log and the HQ relay log on VPS1", tests="scripts/watchdog/watchdog-logic.test.sh")

    # 9 readiness keeper / watch
    col, prob = "green", None
    mind = min((p_["daysLeft"] for p_ in proofs), default=None)
    if not rd or rd.get("ready") is not True:
        col, prob = "red", "checkout not ready" if rd else "readiness watch silent for 3 h"
    elif mind is not None and mind <= 7:
        col, prob = "amber", f"a readiness proof expires in {mind:.0f} days"
    kl = v.get("keeper_last") or {}
    row(id="readiness", n="9", name="Readiness keeper and watch",
        where="VPS1 · system timers zenod-readiness-watch hourly, keeper daily",
        status=col, problem=prob,
        signal=(f"checkout ready={rd.get('ready')} at {ago(rd.get('at'), ref)}; proofs: "
                + ", ".join(f"{p_['id']} {p_['daysLeft']:.0f} days left" for p_ in proofs)) if rd else "no watch line in 3 h",
        signal_value={"ready": rd.get("ready"), "minProofDaysLeft": mind},
        activity=f"keeper last ran {ago(kl.get('at'), ref)}", activity_at=kl.get("at"),
        error=("no issues" if rd.get("issues") == "[]" else f"issues {rd.get('issues')}") if rd else "watch silent",
        source="zenod-readiness-watch and keeper journals on VPS1",
        tests="scripts/readiness-keeper/keeper.test.py, productionReadiness.test.ts")

    # 10 tester watch
    tw = v.get("testers") or {}
    col = "green" if tw and not tw.get("alerts") and not tw.get("problems") else ("amber" if tw else "red")
    row(id="tester_watch", n="10", name="Tester watch", where="VPS1 · /usr/local/bin/tester-watch, read-only",
        status=col,
        problem=None if col == "green" else (f"{tw.get('alerts')} alerts, {tw.get('problems')} read problems" if tw
                                             else "tester-watch did not answer"),
        signal=(f"{tw.get('count')} tester codes issued, {tw.get('signedUp')} signed up; {tw.get('alerts')} alerts, "
                f"{tw.get('problems')} read problems") if tw else "tester-watch did not answer",
        signal_value={"codes": tw.get("count"), "signedUp": tw.get("signedUp"), "alerts": tw.get("alerts")},
        activity=f"read at {ago(ac.get('generatedAt'), ref)}", activity_at=ac.get("generatedAt"),
        error="none" if col == "green" else "see signal",
        source="tester-watch --redact on VPS1", tests="scripts/tester-watch/tester_watch.test.py")

    # 11 ingress
    cf = v.get("cloudflared")
    row(id="ingress", n="11", name="Ingress tunnel", where="VPS1 · cloudflared-vps1-sites.service",
        status="green" if cf == "active" else "red", problem=None if cf == "active" else f"tunnel service {cf}",
        signal=f"service {cf}", signal_value={"service": cf},
        activity="carries rows 1, 2 and 4", error="none" if cf == "active" else str(cf),
        source="systemctl on VPS1", tests="none: covered by rows 1, 2, 4 probes")

    # 12 host disk and observatory
    dpct = v.get("disk_root_pct")
    ob = d.get("observatory") or {}
    col = "green" if dpct is not None and dpct < 80 and ob.get("status") == 200 else (
        "amber" if dpct is not None and dpct < 90 else "red")
    dg = v.get("disk_guard") or {}
    row(id="host", n="12", name="Host VPS1: disk and observatory",
        where="VPS1 · disk-guard timer, observatory on tailnet :8090",
        status=col, problem=None if col == "green" else f"root disk {dpct}% used, observatory → {ob.get('status')}",
        signal=f"root disk {dpct}% used; observatory → {ob.get('status')}",
        signal_value={"diskPct": dpct, "observatoryHttp": ob.get("status")},
        activity=f"disk guard last ran {ago(dg.get('at'), ref)}" if dg else "disk guard silent in 30 min",
        activity_at=dg.get("at"),
        error="none" if col == "green" else "disk or observatory",
        source="df and disk-guard journal on VPS1; observatory from VPS3", tests="infra-vps tests/test_disk_guard.py",
        link="https://health.alpha9.io/")
    return R


# --------------------------------------------------------------------------------------------- S4: smoke × probe

def smoke_summary(latest: dict | None) -> dict | None:
    """The S3 latest.json (zenod-smoke/v1) cut down for raw["smoke"]: run time, test-run flag, failing checks."""
    if not latest or not latest.get("startedAt"):
        return None
    comps: dict = {}
    for c in latest.get("checks") or []:
        x = comps.setdefault(c.get("component"), {"ok": True, "pass": 0, "fail": 0, "failing": []})
        if c.get("ok"):
            x["pass"] += 1
        else:
            x["ok"] = False
            x["fail"] += 1
            x["failing"].append({"id": c.get("id"), "title": c.get("title"), "reason": c.get("reason"),
                                 "overridden": bool(c.get("overridden"))})
    return {"at": iso(parse_ts(latest["startedAt"])), "simulated": bool(latest.get("simulated")), "components": comps}


def merge_smoke(status: str, problem: str | None, smoke: dict | None, cid: str, ref: dt.datetime) -> tuple:
    """Probe status × smoke result → (row status, problem, smoke cell for the document). Pure.

    grey stays grey (not deployed, never alerted); no smoke result, no check for this row, or a result older than
    SMOKE_STALE_SECS leaves the probe status as it is; all checks pass leaves it as it is; any failing check makes
    the row red with the smoke reason (after the probe's own problem when the probe also saw one)."""
    if not smoke:
        return status, problem, None
    sc = (smoke.get("components") or {}).get(cid)
    at = parse_ts(smoke.get("at"))
    if not sc or not at:
        return status, problem, None
    stale = (ref - at).total_seconds() > SMOKE_STALE_SECS
    cell = {"at": smoke["at"], "ok": sc["ok"], "pass": sc["pass"], "fail": sc["fail"], "stale": stale,
            "simulated": smoke.get("simulated", False), "reason": None}
    if sc["ok"] or stale or status == "grey":
        return status, problem, cell
    f = sc["failing"]
    why = "smoke check failed: " + "; ".join(f"{x['title']}: {x['reason']}" for x in f[:2])
    if len(f) > 2:
        why += f" (+{len(f) - 2} more)"
    if any(x.get("overridden") for x in f):
        why += " [test run: check pointed at a test target]"
    cell["reason"] = why
    return "red", f"{problem}; {why}" if status in ("amber", "red") and problem else why, cell


# --------------------------------------------------------------------------------------------- history

def load_state(path: str = STATE) -> dict:
    try:
        with open(path) as f:
            st = json.load(f)
        if isinstance(st, dict) and isinstance(st.get("components"), dict):
            return st
    except (OSError, ValueError):
        pass
    return {"components": {}, "transitions": [], "since": None}


def save_state(st: dict, path: str = STATE) -> None:
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    tmp = path + ".tmp"
    with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        json.dump(st, f, indent=1)
    os.replace(tmp, path)


def _record_error(h: dict, e: dict) -> None:
    """Fold one error event into a component's history. Same `what` again = same error, newer `at`."""
    cur = h.get("last_error")
    if cur and cur["what"] == e["what"]:
        if e["at"] > cur["at"]:
            cur["at"] = e["at"]
            cur["source"] = e["source"]
        return
    if cur and e["at"] <= cur["at"]:
        # an older, different error reported late: keep it in the list only
        if not any(x["what"] == e["what"] and x["first_seen"] == e["at"] for x in h["errors"]):
            h["errors"].append({"at": e["at"], "first_seen": e["at"], "what": e["what"], "source": e["source"]})
            h["errors"].sort(key=lambda x: x["at"])
            del h["errors"][:-KEEP_ERRORS]
        return
    new = {"at": e["at"], "first_seen": e["at"], "what": e["what"], "source": e["source"]}
    h["last_error"] = new
    h["errors"].append(new)
    del h["errors"][:-KEEP_ERRORS]


def aggregate(raw: dict, state: dict) -> tuple[dict, dict]:
    """Raw probe + previous state → (document, new state). Pure apart from the inputs."""
    st = json.loads(json.dumps(state))   # never mutate the caller's copy
    st.setdefault("components", {})
    st.setdefault("transitions", [])
    st["since"] = st.get("since") or raw["probedAt"]
    out, new_t = [], []
    ref = parse_ts(raw["probedAt"])
    for c in components(raw):
        probe_status = c["status"]
        c["status"], c["problem"], smoke = merge_smoke(c["status"], c["problem"], raw.get("smoke"), c["id"], ref)
        h = st["components"].setdefault(c["id"], {"last_error": None, "errors": [], "last_activity": None,
                                                  "status": None, "status_since": None})
        h.setdefault("errors", [])
        events = sorted(c["events"], key=lambda e: e["at"])
        if c["status"] in ("amber", "red"):
            by = "smoke" if smoke and smoke["reason"] and probe_status not in ("amber", "red") else "probe"
            events.append({"at": c["checked_at"], "what": c["problem"], "source": f"{by}: {c['status']}"})
        for e in events:
            _record_error(h, e)
        la = h.get("last_activity")
        if c["activity_at"] and (not la or c["activity_at"] >= la["at"]):
            h["last_activity"] = {"at": c["activity_at"], "what": AGO.sub("", c["activity"])}
        prev = h.get("status")
        if prev != c["status"]:
            if prev is not None:
                new_t.append({"component": c["id"], "name": c["name"], "from": prev, "to": c["status"],
                              "at": c["checked_at"], "reason": c["problem"] or c["signal"],
                              "alert": "red" in (prev, c["status"])})
            h["status"], h["status_since"] = c["status"], c["checked_at"]
        la = h.get("last_activity")
        out.append({
            "id": c["id"], "n": c["n"], "name": c["name"], "where": c["where"], "status": c["status"],
            "status_since": h["status_since"], "signal": c["signal"], "signal_value": c.get("signal_value") or {},
            "checked_at": c["checked_at"],
            "last_activity": dict(la, from_history=la["at"] != c["activity_at"]) if la else None,
            "activity": c["activity"], "last_error": h["last_error"], "errors": list(reversed(h["errors"])),
            "error_now": c["error"], "problem": c["problem"], "probe_status": probe_status, "smoke": smoke,
            "source": c["source"], "tests": c["tests"],
            **({"link": c["link"]} if c.get("link") else {})})
    st["transitions"] = (st["transitions"] + new_t)[-KEEP_TRANSITIONS:]
    doc = {"schema": SCHEMA, "checked_at": raw["probedAt"], "history_since": st["since"],
           "summary": {s: sum(1 for c in out if c["status"] == s) for s in STATUSES},
           "components": out, "transitions": st["transitions"][-DOC_TRANSITIONS:], "raw": raw}
    return doc, st


# --------------------------------------------------------------------------------------------- S5 interface

def load_doc(src: str) -> dict:
    if re.match(r"https?://", src):
        with urllib.request.urlopen(src, timeout=20) as r:
            return json.loads(r.read())
    with open(os.path.expanduser(src)) as f:
        return json.load(f)


def transitions_after(doc: dict, after: str | None = None, alert_only: bool = False) -> list[dict]:
    """Transitions newer than `after` (ISO UTC, exclusive), oldest first."""
    return [t for t in doc.get("transitions") or []
            if (not after or t["at"] > after) and (t.get("alert") or not alert_only)]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("transitions", help="status changes as JSON lines, oldest first")
    t.add_argument("--doc", required=True, help="path or URL of the published probe.json")
    t.add_argument("--after", help="only transitions with at > this ISO UTC time")
    t.add_argument("--alert-only", action="store_true", help="only to-red and back-from-red")
    s = sub.add_parser("status", help="one line per component")
    s.add_argument("--doc", required=True)
    a = ap.parse_args(argv)
    doc = load_doc(a.doc)
    if doc.get("schema") != SCHEMA:
        print(f"not a {SCHEMA} document", file=sys.stderr)
        return 2
    if a.cmd == "transitions":
        for x in transitions_after(doc, a.after, a.alert_only):
            print(json.dumps(x))
    else:
        for c in doc["components"]:
            le = c.get("last_error") or {}
            print(f"{c['id']:<13} {c['status']:<5} since {c['status_since']}  last error "
                  f"{le.get('at', '-')} {le.get('what', '')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
