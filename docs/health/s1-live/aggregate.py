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

def newest_publish(runs: list[dict] | None) -> dict | None:
    """The successful publish.yml run created last, from a list of runs. A 1-item `gh run list` page sometimes
    comes back with an old run (2026-11-03: a September run, 779f74c, made the cloud row falsely amber), so the
    probe reads a page of runs and picks the newest by createdAt instead of trusting the API's order."""
    runs = [r for r in (runs or []) if r.get("headSha") and parse_ts(r.get("createdAt"))]
    return max(runs, key=lambda r: parse_ts(r["createdAt"]), default=None)


STALL_MIN = 60  # ZAL-A8: saves failing or WhatsApp messages without a "Saved" reply for this long turn a row red


CHAT_REPLY_S = 300  # ZAL-A12: a chat job finished this soon after a WhatsApp message answered it (a question, no "Saved")


def reply_stall(inbound_times: list[str] | None, last_saved_reply: str | None, ref: dt.datetime,
                minutes: int = STALL_MIN, chat_replies: list[str] | None = None) -> dt.datetime | None:
    """The first WhatsApp message after the last "Saved" reply, when it is older than `minutes`: messages are
    getting no reply (2026-11-04 to 11-06 went 45 h unnoticed). None while every older message had a reply after it.
    A message answered by a chat job within CHAT_REPLY_S was a question, not a save, and counts as replied."""
    last = parse_ts(last_saved_reply)
    chats = [c for c in (parse_ts(x) for x in chat_replies or []) if c]
    waiting = [t for t in (parse_ts(x) for x in inbound_times or []) if t and (last is None or t > last)
               and not any(0 <= (c - t).total_seconds() <= CHAT_REPLY_S for c in chats)]
    first = min(waiting, default=None)
    return first if first and (ref - first).total_seconds() > minutes * 60 else None


ALERT_MIN = 15  # EPIC-24 M2: a failure a person would notice turns its alert row red for this long (and alerts)


def recent_ops(ops: list | None, kinds: tuple, ref: dt.datetime, minutes: int = ALERT_MIN) -> list[tuple[dt.datetime, str]]:
    """(time, reason) of the failure events of these kinds in the last `minutes`, oldest first."""
    out = []
    for x in ops or []:
        t = parse_ts(x[0]) if len(x) == 3 else None
        if t and x[1] in kinds and 0 <= (ref - t).total_seconds() <= minutes * 60:
            out.append((t, x[2]))
    return sorted(out)


def day_ops(ops: list | None, kinds: tuple, ref: dt.datetime) -> list[tuple[dt.datetime, str]]:
    return recent_ops(ops, kinds, ref, minutes=24 * 60)


def saves_failing(since: str | None, ref: dt.datetime, minutes: int = STALL_MIN) -> dt.datetime | None:
    """When saves started failing with none finished since, if that is longer ago than `minutes`."""
    t = parse_ts(since)
    return t if t and (ref - t).total_seconds() > minutes * 60 else None


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
    # root D28 (EPIC-24 M10): staging follows main and must catch up with the newest image; production moves
    # only on a promote, so it lagging main is expected. Probes without a staging reading keep the old rule.
    st = ((d.get("staging") or {}).get("json") or {}) if "staging" in d else None
    follow = (st.get("sha") or "")[:7] if st is not None else sha
    if pub and follow and pub != follow:
        pt = parse_ts((d.get("publish") or {}).get("createdAt"))
        if pt and (ref - pt).total_seconds() > 1800 and col == "green":
            col, prob = "amber", (f"staging sha {follow} is behind the newest published image {pub} for over 30 min"
                                  if st is not None else f"live sha {sha} is behind the newest published image {pub} for over 30 min")
        notes.append(f"newest published image is {pub}")
    if st is not None:
        notes.append(f"staging runs {follow or '?'}; production moves on a promote")
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
    failing = saves_failing((v.get("zenod_log") or {}).get("capturesFailingSince"), ref)
    if ac.get("error"):
        col, prob = "red", "tester-watch could not read the ledgers"
    elif failing:
        col, prob = "red", f"saves failing since {ago(iso(failing), ref)}: no save has finished since"
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
    stall = reply_stall(pl.get("inboundTimes"), ac.get("lastSavedReply"), ref,
                        chat_replies=(v.get("zenod_log") or {}).get("chatReplies"))
    if p.get("status") != 200 or pj.get("status") != "ok" or wa.get("state") != "connected":
        col, prob = "red", f"/api/health → {p.get('status')} “{pj.get('status')}”, WhatsApp {wa.get('state')}"
    elif stall:
        col, prob = "red", f"no “Saved” reply since a WhatsApp message at {ago(iso(stall), ref)}"
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
    # A tester alert (renewal due, subscription past_due, cap near, failed captures) needs an agent today: red, so
    # it reaches the HQ alert thread (E23-U1). Read problems alone stay amber.
    col = "red" if not tw or tw.get("alerts") else ("amber" if tw.get("problems") else "green")
    row(id="tester_watch", n="10", name="Tester watch", where="VPS1 · /usr/local/bin/tester-watch, read-only",
        status=col,
        problem=None if col == "green" else (("; ".join(tw.get("alertLines") or [])
                                              or f"{tw.get('alerts')} alerts, {tw.get('problems')} read problems") if tw
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

    # 13-19 EPIC-24 M2 (19: EPIC-26 S5): what a person would notice. Each row is red while such a failure happened in the last
    # ALERT_MIN minutes (or, for replies, a WhatsApp message has waited that long), so it reaches the HQ alert thread
    # on the next run (every 5 min) and clears by itself once ALERT_MIN minutes pass without one.
    ops = zl.get("ops") or []
    app5xx = [[t, "app", "http_5xx"] for h in ("cloud.zenod.dev", "zenod.dev") for t in (acc.get(h) or {}).get("app5xx") or []]

    def alert_row(n, cid, name, kinds, what, where, source, tests, extra=None, events=None):
        rows = extra if extra is not None else ops
        now_ = recent_ops(rows, kinds, ref)
        day_ = day_ops(rows, kinds, ref)
        reasons: dict[str, int] = {}
        for _, r in now_:
            reasons[r] = reasons.get(r, 0) + 1
        newest = day_[-1] if day_ else None
        prob = None
        if now_:
            prob = (f"{len(now_)} {what} in the last {ALERT_MIN} min, newest {ago(iso(now_[-1][0]), ref)} ("
                    + ", ".join(f"{k} {v}" for k, v in sorted(reasons.items())) + ")"
                    + (" [drill: staged fault]" if all(r.startswith("drill_") for r in reasons) else ""))
        row(id=cid, n=n, name=name, where=where, status="red" if now_ else "green", problem=prob,
            signal=(prob or f"no {what} in the last {ALERT_MIN} min") + f"; {len(day_)} in 24 h",
            signal_value={"window": len(now_), "day": len(day_), "reasons": reasons},
            activity=f"last one {ago(iso(newest[0]), ref)} ({newest[1]})" if newest else "none in 24 h",
            activity_at=None,
            error=f"last {ago(iso(newest[0]), ref)}: {newest[1]}" if newest else "none in 24 h",
            events=(events or []) + [ev(iso(newest[0]), f"{what}: {newest[1]}", source)] if newest else (events or []),
            source=source, tests=tests)

    alert_row("13", "alert_saves", "Alerts: failed or stuck saves", ("save",), "failed or stuck saves",
              "VPS1 · zenod-mt: a save job that failed, or one still waiting after 15 min",
              "zenod-mt container log ([task-job] … failed, [ops-alert] save)",
              "packages/server/test/opsAlerts.test.ts; test_aggregate.py AlertRows")

    # replies: the ZAL-A8 stall rule at 15 min instead of 60, plus staged faults
    rstall = reply_stall(pl.get("inboundTimes"), ac.get("lastSavedReply"), ref, minutes=ALERT_MIN,
                         chat_replies=zl.get("chatReplies"))
    rdrill = recent_ops(ops, ("reply",), ref)
    rprob = None
    if rstall:
        rprob = f"a WhatsApp message from {ago(iso(rstall), ref)} has had no reply"
    elif rdrill:
        rprob = f"a WhatsApp message with no reply, {ago(iso(rdrill[-1][0]), ref)} [drill: staged fault]"
    row(id="alert_replies", n="14", name="Alerts: WhatsApp messages with no reply",
        where="VPS1 · Phylax receives, zenod-mt saves or answers and replies",
        status="red" if rprob else "green", problem=rprob,
        signal=rprob or f"every WhatsApp message got its reply within {ALERT_MIN} min",
        signal_value={"waitingSince": iso(rstall) if rstall else None},
        activity=f"last inbound {ago(pl.get('lastInbound'), ref)}; last “Saved” reply {ago(ac.get('lastSavedReply'), ref)}",
        activity_at=None, error=rprob or "none",
        source="phylax container log (message read) and tester-watch (last “Saved” reply), chat replies from zenod-mt",
        tests="test_aggregate.py ReplyStall and AlertRows")

    alert_row("15", "alert_answers", "Alerts: chat and ask_brain answers that fail", ("answer",),
              "failed or timed-out answers",
              "VPS1 · zenod-mt: WhatsApp and app chat, MCP ask_brain",
              "zenod-mt container log ([task-job] … failed (chat), [chat] stream failed, [ops-alert] answer)",
              "packages/server/test/opsAlerts.test.ts; test_aggregate.py AlertRows")
    alert_row("16", "alert_signins", "Alerts: failed sign-ins", ("signin",), "failed sign-ins",
              "VPS1 · zenod-mt: Google and GitHub sign-in at cloud.zenod.dev/auth",
              "zenod-mt container log ([ops-alert] signin)",
              "packages/server/test/opsAlerts.test.ts; test_aggregate.py AlertRows")
    alert_row("17", "alert_app", "Alerts: app errors (5xx and errors in the browser)", ("app",), "app errors",
              "VPS1 · cloud.zenod.dev and zenod.dev; the app reports its own errors to /api/public/client-error",
              "Traefik access log (5xx) and zenod-mt container log ([ops-alert] app)",
              "packages/server/test/opsAlerts.test.ts, apps/web client-errors.test.ts; test_aggregate.py AlertRows",
              extra=sorted(ops + app5xx))
    alert_row("18", "alert_helpers", "Alerts: helper runs that fail", ("helper",), "failed helper runs",
              "VPS1 · zenod-mt: helpers (scheduled and run now)",
              "zenod-mt container log ([ops-alert] helper)",
              "packages/server/test/opsAlerts.test.ts; test_aggregate.py AlertRows")

    # 19 E26-S8: AI credit. Background work runs on DeepSeek's prepaid balance, chat and voice on OpenRouter; when
    # either runs dry, capture stops for every user. Red days before that (days left at the current daily spend,
    # from remember_credit()), not only at a fixed line, and the text names who tops up and where.
    cr = d["credit"] if "credit" in d else remember_credit(d, {}, ref)["credit"]
    parts, worst, values = [], "green", {}
    rank = {"green": 0, "amber": 1, "red": 2}
    for prov in ("deepseek", "openrouter"):
        x = cr.get(prov) or {}
        col_, text = credit_status(prov, x)
        values[prov] = {k: x.get(k) for k in ("state", "balanceUsd", "perDayUsd", "daysLeft", "refusals")}
        parts.append(text)
        if rank[col_] > rank[worst]:
            worst = col_
    drill = any(x.get("drill") for x in cr.values())
    reds = [t for prov, t in zip(("deepseek", "openrouter"), parts)
            if credit_status(prov, cr.get(prov) or {})[0] != "green"]
    prob = None
    if worst != "green":
        prob = "; ".join(reds) + (" [drill: staged low balance]" if drill else "")
    row(id="credit", n="19", name="AI credit: DeepSeek and OpenRouter", remote=False,
        where="DeepSeek prepaid balance (background work) and the platform OpenRouter key (chat, voice), read by "
              "cloud.zenod.dev/api/health",
        status=worst, problem=prob,
        signal="; ".join(parts),
        signal_value=values,
        activity=f"balances read {ago((cr.get('deepseek') or {}).get('checkedAt'), ref)}",
        activity_at=None,
        error=prob or "none",
        source="GET /api/health (background, credit.openrouter) from VPS3; credit refusals (402) in the zenod-mt "
               "and phylax container logs; daily spend from the balance samples this page keeps",
        tests="test_aggregate.py Credit; packages/server/test/backgroundRoute.test.ts")
    # 20 EPIC-26 S5: tester month ends run by themselves; only an exception needs a person.
    alert_row("20", "alert_testers", "Alerts: a tester month end that needs a person", ("tester",),
              "tester month-end exceptions",
              "VPS1 · zenod-mt: the tester month-end job (extend if used in 14 days, else end gently)",
              "zenod-mt container log ([ops-alert] tester)",
              "packages/server/test/testerMonthEnd.test.ts; test_aggregate.py AlertRows")
    return R


CREDIT_RED_DAYS, CREDIT_AMBER_DAYS = 5, 10      # E26-S8: days left at the current daily spend
CREDIT_RED_USD, CREDIT_AMBER_USD = 2.0, 5.0     # and a floor for when the spend is not known yet
CREDIT_SPEND_DAYS = 3                           # the daily spend is the drop over the last 3 days
CREDIT_MIN_HOURS = 6                            # with fewer hours of samples the spend is not known yet
CREDIT_KEEP_DAYS = 8
CREDIT_REFUSAL_HOURS = 6
TOP_UP = {
    "deepseek": ("DeepSeek", "Jordi tops up at https://platform.deepseek.com/top_up"),
    "openrouter": ("OpenRouter", "Jordi adds credit at https://openrouter.ai/settings/credits or raises "
                                 "the key limit at https://openrouter.ai/settings/keys"),
}


def credit_status(prov: str, x: dict) -> tuple[str, str]:
    """(colour, one line) for one provider's credit summary from remember_credit()."""
    name, who = TOP_UP[prov]
    bal, per, days = x.get("balanceUsd"), x.get("perDayUsd"), x.get("daysLeft")
    state = x.get("state")
    if x.get("refusals"):
        return "red", f"{name} refused {x['refusals']} calls for credit in the last {CREDIT_REFUSAL_HOURS} h. {who}"
    if state in (None, "off"):
        return "amber", f"{name}: not reported by cloud.zenod.dev/api/health (see row 2)"
    if state == "empty" or (bal is not None and bal <= 0):
        return "red", f"{name} is out of credit (${bal if bal is not None else 0:.2f}). {who}"
    if state == "unlimited":
        return "green", (f"{name}: the platform key has no limit; spent ${per:.2f} a day" if per is not None else
                         f"{name}: the platform key has no limit") + "; a credit refusal turns this row red"
    if bal is None:
        return "amber", f"{name}: balance could not be read"
    spend = f"about {days:.1f} days left at ${per:.2f} a day" if days is not None else (
        "no spend in the last days" if per == 0 else "daily spend not known yet")
    line = f"{name}: ${bal:.2f} left, {spend}"
    if (days is not None and days <= CREDIT_RED_DAYS) or bal <= CREDIT_RED_USD:
        return "red", f"{line}. {who}"
    if (days is not None and days <= CREDIT_AMBER_DAYS) or bal <= CREDIT_AMBER_USD:
        return "amber", f"{line}. {who}"
    return "green", line


def spend_per_day(samples: list, ref: dt.datetime) -> float | None:
    """USD spent a day from [iso, balance] samples, oldest first: the drops over the last CREDIT_SPEND_DAYS
    (a top-up is a rise and is not spend) over the hours covered. None with under CREDIT_MIN_HOURS of samples."""
    pts = [(parse_ts(t), b) for t, b in samples if parse_ts(t) and isinstance(b, (int, float))
           and (ref - parse_ts(t)).total_seconds() <= CREDIT_SPEND_DAYS * 86400]
    if len(pts) < 2:
        return None
    hours = (pts[-1][0] - pts[0][0]).total_seconds() / 3600
    if hours < CREDIT_MIN_HOURS:
        return None
    drop = sum(max(a[1] - b[1], 0) for a, b in zip(pts, pts[1:]))
    return round(drop / hours * 24, 4)


def remember_credit(raw: dict, st: dict, ref: dt.datetime) -> dict:
    """E26-S8: keep one balance sample per provider per 30 min in the state (8 days) and put a credit summary
    in raw["credit"]: state, balanceUsd, perDayUsd, daysLeft, refusals (402s in the logs), drill. A staged
    `credit` drill (probe.py --drill credit) shows DeepSeek at $1.00 for ALERT_MIN minutes and is never sampled.
    Mutates `st` (the caller's copy), returns a new raw."""
    j = ((raw.get("cloud") or {}).get("json") or {})
    bg = j.get("background") or {}
    orx = ((j.get("credit") or {}).get("openrouter")) or {}
    keep = st.setdefault("credit", {})
    v = raw.get("vps1") or {}
    ops = ((v.get("zenod_log") or {}).get("ops") or []) + ((v.get("phylax_log") or {}).get("ops") or [])
    refusals = recent_ops(ops, ("credit",), ref, minutes=CREDIT_REFUSAL_HOURS * 60)
    out = {}
    for prov, state, bal, at in (("deepseek", bg.get("state"), bg.get("balanceUsd"), bg.get("checkedAt")),
                                 ("openrouter", orx.get("state"), orx.get("remainingUsd"), orx.get("checkedAt"))):
        samples = [x for x in keep.get(prov) or [] if parse_ts(x[0]) and
                   (ref - parse_ts(x[0])).total_seconds() <= CREDIT_KEEP_DAYS * 86400]
        if isinstance(bal, (int, float)) and state not in ("unknown", "off", "unlimited"):
            last = parse_ts(samples[-1][0]) if samples else None
            if not last or (ref - last).total_seconds() >= 1800:
                samples.append([iso(ref), bal])
            elif samples:
                samples[-1][1] = bal if bal < samples[-1][1] else samples[-1][1]
        keep[prov] = samples
        per = spend_per_day(samples, ref)
        if prov == "openrouter" and per is None:
            w, dly = orx.get("usageWeeklyUsd"), orx.get("usageDailyUsd")
            per = round(w / 7, 4) if isinstance(w, (int, float)) and w > 0 else (
                dly if isinstance(dly, (int, float)) else None)
        x = {"state": state, "balanceUsd": bal if isinstance(bal, (int, float)) else None, "perDayUsd": per,
             "checkedAt": at, "refusals": sum(1 for _, r in refusals if r.startswith(prov) and not r.startswith("drill_")),
             "drill": False}
        if prov == "deepseek" and any(r.startswith("drill_") for _, r in recent_ops(ops, ("credit",), ref)):
            x.update(state="low", balanceUsd=1.0, drill=True)
        last = (st.get("creditLast") or {}).get(prov)
        if state in (None, "unknown") and last and parse_ts(last.get("checkedAt")) and \
                (ref - parse_ts(last["checkedAt"])).total_seconds() <= 3600:
            # one run where the cloud app did not answer (row 2 shows that): keep the last reading for an hour
            x.update(state=last["state"], balanceUsd=last["balanceUsd"], checkedAt=last["checkedAt"])
        elif state not in (None, "unknown"):
            st.setdefault("creditLast", {})[prov] = {"state": state, "balanceUsd": x["balanceUsd"], "checkedAt": at}
        b = x["balanceUsd"]
        x["daysLeft"] = round(b / per, 1) if b is not None and per else None
        out[prov] = x
    new = json.loads(json.dumps(raw))
    new["credit"] = out
    return new


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


CHAT_REPLY_KEEP_DAYS = 8


def remember_chat_replies(raw: dict, st: dict, ref: dt.datetime) -> dict:
    """ZAL-A15: a WhatsApp question is answered by a chat job, seen only as a `done: chat` line in zenod-mt's
    logs. Docker keeps the last 5 containers and production rolls many times a day, so those lines vanish and an
    answered question turned the Phylax row red as "no reply". Every chat reply seen is kept in the state for
    8 days and merged back into the raw probe. Mutates `st` (the caller's copy), returns a new raw."""
    zl = ((raw.get("vps1") or {}).get("zenod_log") or {})
    seen = {x for x in st.get("chatReplies") or [] if parse_ts(x)} | {x for x in zl.get("chatReplies") or [] if parse_ts(x)}
    keep = sorted(x for x in seen if (ref - parse_ts(x)).total_seconds() <= CHAT_REPLY_KEEP_DAYS * 86400)[-500:]
    st["chatReplies"] = keep
    if not zl and "vps1" not in raw:
        return raw
    out = json.loads(json.dumps(raw))
    out.setdefault("vps1", {}).setdefault("zenod_log", {})["chatReplies"] = keep
    return out


def aggregate(raw: dict, state: dict) -> tuple[dict, dict]:
    """Raw probe + previous state → (document, new state). Pure apart from the inputs."""
    st = json.loads(json.dumps(state))   # never mutate the caller's copy
    st.setdefault("components", {})
    st.setdefault("transitions", [])
    st["since"] = st.get("since") or raw["probedAt"]
    out, new_t = [], []
    ref = parse_ts(raw["probedAt"])
    raw = remember_chat_replies(raw, st, ref)
    raw = remember_credit(raw, st, ref)
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
