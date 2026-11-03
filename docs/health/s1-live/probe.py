#!/usr/bin/env python3
"""EPIC-6 S1 live inventory page: one row per component in docs/health/INVENTORY.md.

Runs on VPS3 (systemd --user timer, every 5 min). Read-only: public health endpoints from here, plus one
`ssh hetzner_vps_1 python3 - --remote` that uses only the narrow sudo rules t3agent has on VPS1 (docker
ps/inspect/logs --timestamps, journalctl, tester-watch --redact, the dokploy wrapper's `apps` listing,
the Traefik access log). Output is counts, states and timestamps only: no env, no ids, no message text.

    python3 probe.py --out ~/artifacts/epic6-s1-health      # writes index.html + probe.json
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import secrets
import time
import os
import re
import subprocess
import sys
import urllib.request

UTC = dt.timezone.utc


def now() -> dt.datetime:
    return dt.datetime.now(UTC)


def iso(t: dt.datetime | None) -> str | None:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if t else None


def parse_ts(s: str | None) -> dt.datetime | None:
    if not s:
        return None
    s = s.strip()
    m = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?(Z|[+-]\d\d:?\d\d)?", s)
    if not m:
        return None
    base = dt.datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S")
    tz = m.group(3) or "Z"
    if tz == "Z":
        return base.replace(tzinfo=UTC)
    sign = 1 if tz[0] == "+" else -1
    hh, mm = int(tz[1:3]), int(tz[-2:])
    return (base - sign * dt.timedelta(hours=hh, minutes=mm)).replace(tzinfo=UTC)


def sh(cmd: list[str], timeout: int = 60, stdin: str | None = None) -> str:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, input=stdin)
        return r.stdout
    except Exception:
        return ""


# --------------------------------------------------------------------------------------------- sign-in link (S1 it.3)

LINK_STATE = os.path.expanduser("~/.config/zenod-health/signin.json")   # VPS3, 0600, never in the repo
MAGIC_DIR = ".local/share/zenod-health/magic"                           # VPS1, mounted at /srv/magic in the gate
LINK_DAYS, REMINT_BEFORE = 7, 24 * 3600


def signin_link() -> dict | None:
    """Keep one unused one-time sign-in link for health.zenod.dev (gate.py redeems it once).

    It is shown only on the tailnet copy of the page, which is already readable without a password,
    so it opens nothing new to anyone. Re-minted when used or less than a day from expiry."""
    try:
        st = json.load(open(LINK_STATE))
    except (OSError, ValueError):
        st = None
    now_s = int(time.time())
    if st and st["exp"] - now_s > REMINT_BEFORE:
        alive = sh(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "hetzner_vps_1",
                    f"test -e {MAGIC_DIR}/{st['hash']} && echo yes"], timeout=30).strip()
        if alive == "yes":
            return st
    token = secrets.token_hex(32)
    new = {"hash": hashlib.sha256(token.encode()).hexdigest(), "exp": now_s + LINK_DAYS * 86400,
           "url": f"https://health.zenod.dev/login/{token}"}
    old = f"rm -f {MAGIC_DIR}/{st['hash']}; " if st and re.fullmatch(r"[0-9a-f]{64}", st.get("hash", "")) else ""
    ok = sh(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "hetzner_vps_1",
             f"umask 077 && mkdir -p {MAGIC_DIR} && {old}find {MAGIC_DIR} -name '*.used' -mtime +30 -delete; "
             f"printf %s {new['exp']} > {MAGIC_DIR}/{new['hash']} && echo ok"], timeout=30).strip()
    if ok != "ok":
        return None
    os.makedirs(os.path.dirname(LINK_STATE), mode=0o700, exist_ok=True)
    tmp = LINK_STATE + ".tmp"
    with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        json.dump(new, f)
    os.replace(tmp, LINK_STATE)
    return new


# --------------------------------------------------------------------------------------------- remote (VPS1)

ZENOD_SVC = "zenod-mt-fxpzoo"
PHYLAX_SVC = "app-index-back-end-panel-6zm3qg"
RUNNER_APPS = ("epaminon", "callisthenes", "ring", "herald", "zenod-cloud-test")


def remote() -> dict:
    out: dict = {"at": iso(now())}
    sudo = ["sudo", "-n"]

    # containers
    ids = sh(sudo + ["docker", "ps", "-aq", "--no-trunc"]).split()
    fmt = "{{.Id}}|{{.Name}}|{{.RestartCount}}|{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}|{{json .State}}"
    conts = {}
    if ids:
        for line in sh(sudo + ["docker", "inspect", "--format", fmt] + ids).splitlines():
            parts = line.split("|", 5)
            if len(parts) < 6:
                continue
            name = parts[1].lstrip("/")
            for svc in (ZENOD_SVC, PHYLAX_SVC):
                if name.startswith(svc + "."):
                    st = json.loads(parts[5])
                    if st.get("Running"):
                        conts[svc] = {"id": parts[0], "restarts": int(parts[2]), "startedAt": st.get("StartedAt"),
                                      "running": True}
    out["containers"] = {k: {kk: vv for kk, vv in v.items() if kk != "id"} for k, v in conts.items()}

    # dokploy wrapper: non-secret listing only
    apps = {}
    for line in sh(["dokploy", "apps"]).splitlines():
        m = re.match(r"\S+\s+zenod/production\s+(.+?)\s+appName=\S+\s+id=\S+\s+status=(\S+)\s+image=(\S+)", line)
        if m:
            apps.setdefault(m.group(1).strip(), []).append({"status": m.group(2), "image": m.group(3)})
    out["dokploy"] = apps

    t_now = now()
    until = iso(t_now)

    def logs(svc: str, since: dt.datetime) -> list[tuple[dt.datetime, str]]:
        c = conts.get(svc)
        if not c:
            return []
        start = parse_ts(c["startedAt"]) or since
        s = max(since, start - dt.timedelta(seconds=1))
        raw = sh(sudo + ["docker", "logs", "--since", iso(s), "--until", until, "--timestamps", c["id"]], timeout=90)
        res = []
        for line in raw.splitlines():
            ts, _, rest = line.partition(" ")
            t = parse_ts(ts)
            if t:
                res.append((t, rest))
        return res

    day = t_now - dt.timedelta(hours=24)
    week = t_now - dt.timedelta(days=7)

    # zenod-mt
    z = {"lastJob": None, "jobs24h": 0, "lastIndex": None, "lastError": None, "errors24h": 0, "lines": 0}
    for t, rest in logs(ZENOD_SVC, week):
        z["lines"] += 1
        m = re.match(r"\[task-job\] \S+ done: (\w+)", rest)
        if m:
            z["lastJob"] = {"at": iso(t), "kind": m.group(1)}
            if t >= day:
                z["jobs24h"] += 1
        m = re.match(r"\[memory-search\] tier-0 index, ([\d.]+) ms \((\d+) rows", rest)
        if m:
            z["lastIndex"] = {"at": iso(t), "ms": float(m.group(1)), "rows": int(m.group(2))}
        err = None
        if rest.startswith("{"):
            try:
                j = json.loads(rest)
                if int(j.get("level", 0)) >= 50:
                    err = str(j.get("event") or "log level error")[:60]
            except Exception:
                pass
        elif re.search(r"\b(error|failed|exception|uncaught)\b", rest, re.I) and "unknown format" not in rest:
            err = "error line" + (" (" + re.sub(r"[^a-z_.-]", "", rest.split()[0].lower())[:30] + ")" if rest.split() else "")
        if err:
            z["lastError"] = {"at": iso(t), "what": err}
            if t >= day:
                z["errors24h"] += 1
    out["zenod_log"] = z

    # phylax
    p = {"lastInbound": None, "inbound24h": 0, "lastReconnect": None, "reconnects24h": 0, "lastError": None,
         "errors24h": 0}
    for t, rest in logs(PHYLAX_SVC, week):
        if rest.startswith("[whatsapp][diag] markRead"):
            p["lastInbound"] = iso(t)
            if t >= day:
                p["inbound24h"] += 1
        elif rest.startswith("[whatsapp][health]"):
            try:
                j = json.loads(rest.split("]", 2)[2].strip())
            except Exception:
                j = {}
            if j.get("event") == "reconnect_scheduled":
                p["lastReconnect"] = {"at": iso(t), "reason": str(j.get("reason") or "")[:60]}
                if t >= day:
                    p["reconnects24h"] += 1
        elif rest.startswith("{"):
            try:
                j = json.loads(rest)
                if int(j.get("level", 0)) >= 50:
                    p["lastError"] = {"at": iso(t), "what": str(j.get("event") or "log level error")[:60]}
                    if t >= day:
                        p["errors24h"] += 1
            except Exception:
                pass
    out["phylax_log"] = p

    # Traefik access log: last real request and last 5xx per host (health checks excluded)
    hosts = {h: {"lastReal": None, "real24h": 0, "last5xx": None, "status5xx": None, "n5xx24h": 0}
             for h in ("zenod.dev", "cloud.zenod.dev", "phylax.zenod.dev")}
    raw = sh(sudo + ["cat", "/etc/dokploy/traefik/dynamic/access.log"], timeout=60)
    for line in raw.splitlines()[-400000:]:
        if '"RequestHost":"' not in line:
            continue
        try:
            j = json.loads(line)
        except Exception:
            continue
        h = hosts.get(j.get("RequestHost"))
        if h is None:
            continue
        t = parse_ts(j.get("StartUTC"))
        if not t:
            continue
        path = j.get("RequestPath") or ""
        status = int(j.get("DownstreamStatus") or 0)
        if not path.startswith("/api/health"):
            h["lastReal"] = iso(t)
            if t >= day:
                h["real24h"] += 1
        if status >= 500:
            h["last5xx"], h["status5xx"] = iso(t), status
            if t >= day:
                h["n5xx24h"] += 1
    out["access"] = hosts

    # journals
    def journal(unit: str, since: str, user: bool = False) -> list[tuple[dt.datetime, str]]:
        cmd = (["journalctl", "--user"] if user else sudo + ["journalctl"]) + \
            ["-u", unit, "--since", since, "--no-pager", "-o", "short-iso"]
        res = []
        for line in sh(cmd).splitlines():
            ts = line.split(" ", 1)[0]
            t = parse_ts(ts)
            if t and "systemd[" not in line and "sudo[" not in line:
                res.append((t, line.split(": ", 1)[-1]))
        return res

    dp = journal("infra-vps-deploy-poller", "-30min", user=True)
    dp = [x for x in dp if "deploy-poller zenod-mt" in x[1]]
    out["deploy_poller"] = {"at": iso(dp[-1][0]), "msg": dp[-1][1][:120]} if dp else None
    rolls = [x for x in journal("infra-vps-deploy-poller", "-14d", user=True)
             if "deploy-poller zenod-mt" in x[1] and "noop" not in x[1]]
    out["deploy_last_roll"] = {"at": iso(rolls[-1][0]), "msg": rolls[-1][1][:120]} if rolls else None

    wd = journal("zenod-watchdog", "-24h")
    out["watchdog"] = {
        "runs24h": sum(1 for _, m in wd if m.startswith("[watchdog") and "ALERT" not in m and "delivery" not in m) or None,
        "alerts24h": sum(1 for _, m in wd if "ALERT[" in m),
        "deliveredNo24h": sum(1 for _, m in wd if "delivery=no" in m),
        "deliveredYes24h": sum(1 for _, m in wd if re.search(r"delivery=(yes|ok|primary|fallback)", m)),
        "lastAlert": iso(max((t for t, m in wd if "ALERT[" in m), default=None)),
        "deadTargets": sorted({u for _, m in wd for u in re.findall(r"Endpoint (https://[^ ]+) returned 404", m)}),
    }
    st = sh(["systemctl", "show", "zenod-watchdog.timer", "-p", "ActiveState", "--value"]).strip()
    out["watchdog"]["timer"] = st

    rw = [x for x in journal("zenod-readiness-watch", "-3h") if "watch ready=" in x[1]]
    if rw:
        t, m = rw[-1]
        mm = re.search(r"ready=(\w+) issues=(\[.*?\]) proofs=(\[.*\])", m)
        proofs = json.loads(mm.group(3)) if mm else []
        out["readiness"] = {"at": iso(t), "ready": mm.group(1) == "True" if mm else None,
                            "issues": mm.group(2) if mm else None,
                            "proofs": [{"id": x["id"], "daysLeft": x["daysLeft"], "expiresAt": x["expiresAt"]}
                                       for x in proofs]}
    else:
        out["readiness"] = None
    rk = [x for x in journal("zenod-readiness-keeper", "-35d") if "] plan " in x[1] or "drill" in x[1]]
    out["keeper_last"] = {"at": iso(rk[-1][0]), "msg": rk[-1][1][-80:]} if rk else None

    # tester-watch aggregate (redacted, no Stripe): counts and newest timestamps only
    try:
        tw = json.loads(sh(sudo + ["/usr/local/bin/tester-watch", "--all", "--json", "--redact", "--no-stripe"],
                           timeout=120))
        accts = tw.get("testers") or []

        def mx(key: str, sub: str):
            v = [a.get(sub, {}).get(key) for a in accts if a.get(sub)]
            v = [x for x in v if x]
            return max(v) if v else None
        bindings: dict[str, int] = {}
        for a in accts:
            b = (a.get("whatsapp") or {}).get("binding") or "none"
            bindings[b] = bindings.get(b, 0) + 1
        out["accounts"] = {
            "generatedAt": tw.get("generated_at"), "count": len(accts),
            "lastSavedReply": mx("last_saved_reply", "saves"), "lastCapture": mx("last_capture_any", "saves"),
            "saves7d": sum((a.get("saves") or {}).get("saved_replies_7d") or 0 for a in accts),
            "captures7d": sum((a.get("saves") or {}).get("captures_7d") or 0 for a in accts),
            "failedCaptures7d": sum((a.get("errors") or {}).get("failed_captures_7d") or 0 for a in accts),
            "capHits24h": sum((a.get("errors") or {}).get("cap_hits_window") or 0 for a in accts),
            "noticeFailures24h": sum((a.get("errors") or {}).get("notice_failures_window") or 0 for a in accts),
            "bindings": bindings, "alerts": len(tw.get("alerts") or []), "problems": len(tw.get("problems") or []),
        }
        tl = json.loads(sh(sudo + ["/usr/local/bin/tester-watch", "--json", "--redact", "--no-stripe"], timeout=120))
        out["testers"] = {"count": len(tl.get("testers") or []),
                          "signedUp": sum(1 for x in tl.get("testers") or [] if x.get("signup") != "not signed up"),
                          "alerts": len(tl.get("alerts") or []), "problems": len(tl.get("problems") or [])}
    except Exception as e:
        out["accounts"] = {"error": type(e).__name__}
        out["testers"] = None

    out["cloudflared"] = sh(["systemctl", "is-active", "cloudflared-vps1-sites.service"]).strip()
    df = sh(["df", "-P", "/"]).splitlines()
    out["disk_root_pct"] = int(df[1].split()[4].rstrip("%")) if len(df) > 1 else None
    dg = journal("infra-vps-disk-guard", "-30min", user=True)
    out["disk_guard"] = {"at": iso(dg[-1][0]), "msg": dg[-1][1][:100]} if dg else None
    return out


# --------------------------------------------------------------------------------------------- local (VPS3)

def get(url: str, timeout: int = 15) -> tuple[int, str, float]:
    t0 = now()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "zenod-epic6-s1-probe"}),
                                    timeout=timeout) as r:
            return r.status, r.read(400_000).decode("utf-8", "replace"), (now() - t0).total_seconds()
    except urllib.error.HTTPError as e:
        return e.code, e.read(50_000).decode("utf-8", "replace"), (now() - t0).total_seconds()
    except Exception as e:
        return 0, type(e).__name__, (now() - t0).total_seconds()


def collect() -> dict:
    d: dict = {"probedAt": iso(now())}
    s, body, secs = get("https://zenod.dev/")
    m = re.search(r"<title>(.*?)</title>", body, re.S)
    d["site"] = {"status": s, "secs": round(secs, 3), "title": html.unescape(m.group(1).strip())[:80] if m else None}
    for key, url in (("cloud", "https://cloud.zenod.dev/api/health"), ("phylax", "https://phylax.zenod.dev/api/health")):
        s, body, secs = get(url)
        try:
            j = json.loads(body)
        except Exception:
            j = {}
        d[key] = {"status": s, "secs": round(secs, 3), "json": j}
    s, _, secs = get("http://100.104.206.10:8090/", timeout=10)
    d["observatory"] = {"status": s, "secs": round(secs, 3)}
    try:
        runs = json.loads(sh(["gh", "run", "list", "-R", "zenod-ai/zenod", "--workflow", "publish.yml", "--branch",
                              "main", "--status", "success", "-L", "1", "--json", "headSha,createdAt"]))
        d["publish"] = runs[0] if runs else None
    except Exception:
        d["publish"] = None
    src = open(os.path.abspath(__file__)).read()
    r = sh(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "hetzner_vps_1", "python3", "-", "--remote"],
           timeout=300, stdin=src)
    try:
        d["vps1"] = json.loads(r)
    except Exception:
        d["vps1"] = {"error": "ssh/remote probe failed"}
    return d


# --------------------------------------------------------------------------------------------- page

def ago(s: str | None, ref: dt.datetime) -> str:
    t = parse_ts(s) if isinstance(s, str) else s
    if not t:
        return "none seen"
    sec = (ref - t).total_seconds()
    if sec < 0:
        sec = 0
    if sec < 120:
        a = f"{int(sec)} s ago"
    elif sec < 7200:
        a = f"{int(sec // 60)} min ago"
    elif sec < 172800:
        a = f"{sec / 3600:.1f} h ago"
    else:
        a = f"{sec / 86400:.1f} days ago"
    return f"{iso(t).replace('T', ' ').replace('Z', ' UTC')} ({a})"


def rows(d: dict) -> list[dict]:
    ref = parse_ts(d["probedAt"])
    v = d.get("vps1") or {}
    acc = v.get("access") or {}
    R = []

    def row(**k):
        R.append(k)

    # 1 site
    site = d["site"]
    ok = site["status"] == 200 and site["title"] and "Zenod" in site["title"]
    a = acc.get("zenod.dev", {})
    row(n="1", name="Marketing site zenod.dev", where="VPS1 · Dokploy app zenod-mt, same container as the cloud app",
        colour="green" if ok else "red",
        signal=f"GET https://zenod.dev/ → {site['status']} in {site['secs']} s, title “{site['title']}”",
        activity=f"last page request {ago(a.get('lastReal'), ref)}; {a.get('real24h', '?')} requests in 24 h (bots included)",
        error=(f"last 5xx {ago(a.get('last5xx'), ref)} ({a.get('status5xx')}); {a.get('n5xx24h')} in 24 h"
               if a.get("last5xx") else "no 5xx in the retained access log"),
        tests="npm test (server static-surface tests, CI). No prod smoke yet: S3 builds it.")

    # 2 cloud
    c = d["cloud"]; j = c["json"]; el = j.get("eventLoop") or {}
    sha = (j.get("sha") or "")[:7]
    pub = (d.get("publish") or {}).get("headSha", "")[:7]
    col = "green"
    notes = []
    if c["status"] != 200 or j.get("status") != "ok":
        col = "red"
    elif (el.get("p99Ms") or 0) > 200 or (el.get("utilization") or 0) > 0.8:
        col = "amber"; notes.append("event loop slow")
    if pub and sha and pub != sha:
        pt = parse_ts((d.get("publish") or {}).get("createdAt"))
        if pt and (ref - pt).total_seconds() > 1800 and col == "green":
            col = "amber"
        notes.append(f"newest published image is {pub}")
    zl = v.get("zenod_log") or {}
    zc = (v.get("containers") or {}).get(ZENOD_SVC) or {}
    row(n="2", name="Cloud app cloud.zenod.dev", where="VPS1 · zenod-mt, image "
        + ", ".join(x["image"].split("/")[-1] for x in (v.get("dokploy") or {}).get("zenod-mt", [])),
        colour=col,
        signal=(f"/api/health → {c['status']} “{j.get('status')}”, sha {sha} "
                f"({'matches' if sha == pub else 'vs'} last publish {pub or '?'}), p99 {el.get('p99Ms')} ms, "
                f"load {el.get('utilization')}; container up since {ago(zc.get('startedAt'), ref)}, "
                f"{zc.get('restarts', '?')} restarts" + ("; " + "; ".join(notes) if notes else "")),
        activity=(f"last finished job {ago((zl.get('lastJob') or {}).get('at'), ref)} "
                  f"({(zl.get('lastJob') or {}).get('kind', '-')}); {zl.get('jobs24h', 0)} jobs in 24 h"),
        error="; ".join(filter(None, [
            (f"last error log line {ago(zl['lastError']['at'], ref)} ({zl['lastError']['what']})"
             if zl.get("lastError") else "no error log lines since the container started"),
            (f"last 5xx {ago(acc['cloud.zenod.dev']['last5xx'], ref)}"
             if (acc.get("cloud.zenod.dev") or {}).get("last5xx") else "no 5xx in access log")])),
        tests="packages/server/test/health.test.ts, eventLoopHealth.test.ts, productionReadiness.test.ts (CI on every push)")

    # 3 database / ledgers
    ac = v.get("accounts") or {}
    rd = v.get("readiness") or {}
    proofs = rd.get("proofs") or []
    bk = next((p for p in proofs if p["id"] == "backup_restore"), None)
    b = ac.get("bindings") or {}
    unavail = sum(n for k, n in b.items() if k not in ("active",))
    col = "green"
    if bk is None or bk["daysLeft"] <= 0:
        col = "red"
    elif bk["daysLeft"] <= 7 or ac.get("failedCaptures7d") or unavail:
        col = "amber"
    row(n="3", name="Database and credits ledger", where="VPS1 · SQLite files on volumes zenod-mt-data and phylax-data",
        colour=col,
        signal=(f"ledgers readable through tester-watch for {ac.get('count', '?')} accounts; "
                f"backup restore drill valid {bk['daysLeft']:.0f} more days (to {bk['expiresAt'][:10]})" if bk else
                "backup proof not found")
               + "; WhatsApp bindings " + ", ".join(f"{k} {n}" for k, n in sorted(b.items())),
        activity=f"last capture written {ago(ac.get('lastCapture'), ref)}; {ac.get('captures7d', '?')} captures in 7 days",
        error=(f"{ac.get('failedCaptures7d', '?')} failed captures in 7 days, {ac.get('capHits24h', '?')} credit-cap hits "
               f"and {ac.get('noticeFailures24h', '?')} failed billing notices in 24 h"),
        tests="scripts/verify-zenod-data.mjs (on a copy); monthly restore drill by the readiness keeper; keeper.test.py")

    # 4 phylax
    p = d["phylax"]; pj = p["json"]
    wa = ((pj.get("channels") or {}).get("whatsapp") or {})
    hb = (pj.get("worker") or {}).get("lastHeartbeatAt")
    hb_age = (ref.timestamp() * 1000 - hb) / 1000 if hb else None
    pl = v.get("phylax_log") or {}
    col = "green"
    if p["status"] != 200 or pj.get("status") != "ok" or wa.get("state") != "connected":
        col = "red"
    elif (hb_age is not None and hb_age > 60) or (pj.get("restart") or {}).get("required"):
        col = "amber"
    lr = pl.get("lastReconnect") or {}
    row(n="4", name="WhatsApp relay Phylax", where="VPS1 · Dokploy app phylax, image "
        + ", ".join(x["image"].split("@")[-1][:19] for x in (v.get("dokploy") or {}).get("phylax", [])),
        colour=col,
        signal=(f"/api/health → {p['status']} “{pj.get('status')}”, sha {(pj.get('sha') or '')[:7]}, WhatsApp "
                f"{wa.get('state')}, receive path {(wa.get('receivePath') or {}).get('status')}, worker heartbeat "
                f"{hb_age:.0f} s old" if hb_age is not None else f"/api/health → {p['status']}"),
        activity=(f"last inbound WhatsApp message {ago(pl.get('lastInbound'), ref)} ({pl.get('inbound24h', 0)} in 24 h); "
                  f"last “Saved” reply sent {ago(ac.get('lastSavedReply'), ref)} ({ac.get('saves7d', '?')} in 7 days)"),
        error="; ".join(filter(None, [
            f"last WhatsApp drop {ago(lr.get('at'), ref)} ({lr.get('reason')}), reconnected; {pl.get('reconnects24h', 0)} drops in 24 h"
            if lr else "no WhatsApp drop since the container started",
            f"last error log line {ago(pl['lastError']['at'], ref)}" if pl.get("lastError") else "0 error log lines"])),
        tests="phylaxUnit.test.ts (health and restart rules), npm run test:phylax-image-contract (CI)")

    # 5 agent runner
    dk = v.get("dokploy") or {}
    sts = {n: dk[n][0]["status"] for n in RUNNER_APPS if dk.get(n)}
    running = [n for n, s in sts.items() if s not in ("idle",)]
    row(n="5", name="Agent runner", where="not deployed · Dokploy apps " + ", ".join(sts) + " are stopped",
        colour="grey" if not running else "amber",
        signal="all idle in Dokploy" if not running else "unexpected status: " + ", ".join(f"{n} {sts[n]}" for n in running),
        activity="agents run inside the cloud app, see row 2", error="n/a",
        tests="scripts/exec-smoke.mjs exists but writes to prod, so it is kept out of the read-only battery")

    # 6 memory search index (EPIC-9)
    ix = zl.get("lastIndex") or {}
    row(n="6", name="Memory search index", where="VPS1 · inside zenod-mt, built on demand per search",
        colour="green" if ix else "grey",
        signal=(f"last index load {ix.get('ms')} ms for {ix.get('rows')} items" if ix else
                "no index load logged since the container started"),
        activity=f"last search index load {ago(ix.get('at'), ref)}" if ix else "none since restart",
        error="see row 2", tests="packages/core/test/memoryIndex.test.ts (CI)")

    # 7 deploy path
    dp = v.get("deploy_poller") or {}
    dr = v.get("deploy_last_roll") or {}
    dpa = (ref - parse_ts(dp["at"])).total_seconds() if dp.get("at") else None
    col = "red" if dpa is None else ("green" if dpa < 600 and ("noop" in dp["msg"] or "roll" in dp["msg"]) else "amber")
    row(n="7", name="Deploy path", where="VPS1 · user timer infra-vps-deploy-poller, every 2 min",
        colour=col, signal=f"last run {ago(dp.get('at'), ref)}: “{dp.get('msg')}”",
        activity=f"last production roll {ago(dr.get('at'), ref)}" if dr else
        f"no roll in the last 14 days of journal; container started {ago(zc.get('startedAt'), ref)}",
        error="none in the last 30 min" if col == "green" else dp.get("msg", "no poller line in 30 min"),
        tests="infra-vps tests/test_deploy_poller.py; scripts/deploy-fleet.test.mjs for the manual script")

    # 8 alerts: watchdog
    w = v.get("watchdog") or {}
    col = "red" if w.get("deliveredNo24h") and not w.get("deliveredYes24h") else "green"
    row(n="8", name="Alerts: host watchdog", where="VPS1 · system timer zenod-watchdog, every 2 min",
        colour=col,
        signal=f"timer {w.get('timer')}; {w.get('alerts24h')} alerts in 24 h, {w.get('deliveredYes24h')} delivered, "
               f"{w.get('deliveredNo24h')} not delivered",
        activity=f"last alert {ago(w.get('lastAlert'), ref)}",
        error=("it checks retired hosts: " + ", ".join(u.replace("https://", "").split("/")[0] for u in w.get("deadTargets") or [])
               + "; nobody receives it. Fixing it is S5") if w.get("deadTargets") else "none",
        tests="scripts/watchdog/watchdog-logic.test.sh")

    # 9 readiness keeper / watch
    col = "green"
    mind = min((p_["daysLeft"] for p_ in proofs), default=None)
    if not rd or rd.get("ready") is not True:
        col = "red"
    elif mind is not None and mind <= 7:
        col = "amber"
    kl = v.get("keeper_last") or {}
    row(n="9", name="Readiness keeper and watch", where="VPS1 · system timers zenod-readiness-watch hourly, keeper daily",
        colour=col,
        signal=(f"checkout ready={rd.get('ready')} at {ago(rd.get('at'), ref)}; proofs: "
                + ", ".join(f"{p_['id']} {p_['daysLeft']:.0f} days left" for p_ in proofs)) if rd else "no watch line in 3 h",
        activity=f"keeper last ran {ago(kl.get('at'), ref)}",
        error=("no issues" if rd.get("issues") == "[]" else f"issues {rd.get('issues')}") if rd else "watch silent",
        tests="scripts/readiness-keeper/keeper.test.py, productionReadiness.test.ts")

    # 10 tester watch
    tw = v.get("testers") or {}
    col = "green" if tw and not tw.get("alerts") and not tw.get("problems") else ("amber" if tw else "red")
    row(n="10", name="Tester watch", where="VPS1 · /usr/local/bin/tester-watch, read-only",
        colour=col,
        signal=(f"{tw.get('count')} tester codes issued, {tw.get('signedUp')} signed up; {tw.get('alerts')} alerts, "
                f"{tw.get('problems')} read problems") if tw else "tester-watch did not answer",
        activity=f"read at {ago(ac.get('generatedAt'), ref)}", error="none" if col == "green" else "see signal",
        tests="scripts/tester-watch/tester_watch.test.py")

    # 11 ingress
    cf = v.get("cloudflared")
    row(n="11", name="Ingress tunnel", where="VPS1 · cloudflared-vps1-sites.service",
        colour="green" if cf == "active" else "red", signal=f"service {cf}",
        activity="carries rows 1, 2 and 4", error="none" if cf == "active" else cf, tests="none: covered by rows 1, 2, 4 probes")

    # 12 host disk and observatory
    dpct = v.get("disk_root_pct")
    ob = d.get("observatory") or {}
    col = "green" if dpct is not None and dpct < 80 and ob.get("status") == 200 else (
        "amber" if dpct is not None and dpct < 90 else "red")
    dg = v.get("disk_guard") or {}
    row(n="12", name="Host VPS1: disk and observatory", where="VPS1 · disk-guard timer, observatory on tailnet :8090",
        colour=col, signal=f"root disk {dpct}% used; observatory → {ob.get('status')}",
        activity=f"disk guard last ran {ago(dg.get('at'), ref)}" if dg else "disk guard silent in 30 min",
        error="none" if col == "green" else "disk or observatory", tests="infra-vps tests/test_disk_guard.py",
        link="https://health.alpha9.io/")
    return R


CSS = """
:root{--g:#1f7a3f;--a:#b26b00;--r:#b3261e;--k:#6b6b6b;--ink:#1d1d1b;--paper:#fbfaf7;--line:#dedad2}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;
color:var(--ink);background:var(--paper)}main{max-width:1400px;margin:0 auto;padding:28px 24px 48px}
h1{font:600 26px/1.2 Georgia,serif;margin:0 0 6px}p.sub{margin:0 0 18px;color:#555}
.sum{display:flex;gap:10px;margin:0 0 18px;flex-wrap:wrap}.pill{padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:#fff}
#signin{background:#e7f1ea;border:1px solid var(--g);padding:10px 14px;border-radius:6px;margin-bottom:14px}
#stale{display:none;background:var(--r);color:#fff;padding:10px 14px;border-radius:6px;margin-bottom:14px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line)}
th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line)}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#666;background:#f4f2ec}
td.c{width:12px;padding:0}td.c span{display:block;width:12px;min-height:64px;height:100%}
.green span{background:var(--g)}.amber span{background:var(--a)}.red span{background:var(--r)}.grey span{background:#b9b6ae}
.st{font-weight:600;text-transform:uppercase;font-size:12px}.st.green{color:var(--g)}.st.amber{color:var(--a)}.st.red{color:var(--r)}.st.grey{color:var(--k)}
td.name{font-weight:600;width:15%}td.where{width:15%;color:#444}td.tests{width:14%;color:#555;font-size:13px}
footer{margin-top:16px;color:#666;font-size:12.5px}code{font-size:12.5px}
"""


def page(d: dict, link: dict | None = None) -> str:
    R = rows(d)
    signin = ""
    if link:
        until = dt.datetime.fromtimestamp(link["exp"], UTC).strftime("%d %b")
        u = html.escape(link["url"])
        signin = (f'<div id="signin">Open this page on any device: <a href="{u}">sign in to health.zenod.dev</a>. '
                  f'The link works once, until {until}, and your browser then stays signed in for 30 days.</div>')
    counts = {c: sum(1 for r in R if r["colour"] == c) for c in ("green", "amber", "red", "grey")}
    tr = []
    for r in R:
        nm = html.escape(r["name"])
        if r.get("link"):
            nm = f'<a href="{html.escape(r["link"])}">{nm}</a>'
        tr.append(
            f'<tr><td class="c {r["colour"]}"><span></span></td><td class="name">{nm}<br>'
            f'<span class="st {r["colour"]}">{r["colour"]}</span></td><td class="where">{html.escape(r["where"])}</td>'
            f'<td>{html.escape(r["signal"])}</td><td>{html.escape(r["activity"])}</td><td>{html.escape(r["error"])}</td>'
            f'<td class="tests">{html.escape(r["tests"])}</td></tr>')
    probed = d["probedAt"]
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="60">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Zenod health inventory · live</title>
<style>{CSS}</style></head><body><main>
{signin}
<div id="stale">This page is stale: the last probe is more than 15 minutes old.</div>
<h1>Zenod health inventory, live</h1>
<p class="sub">Every part of Zenod, where it runs, and what it says right now. Probed <b>{probed.replace('T', ' ').replace('Z', ' UTC')}</b>
<span id="age"></span>, every 5 minutes, read-only. Behind a password at health.zenod.dev; also on the tailnet.</p>
<div class="sum"><span class="pill">🟢 {counts['green']} green</span><span class="pill">🟠 {counts['amber']} amber</span>
<span class="pill">🔴 {counts['red']} red</span><span class="pill">⚪ {counts['grey']} not deployed</span></div>
<table><thead><tr><th></th><th>Component</th><th>Where it runs</th><th>Health signal, live</th><th>Last real activity</th>
<th>Last error</th><th>Test battery</th></tr></thead><tbody>
{''.join(tr)}
</tbody></table>
<footer>Sources: public <code>/api/health</code> endpoints from VPS3; on VPS1 the Traefik access log, container logs
(since each container started), systemd journals, <code>tester-watch --redact</code> and the Dokploy wrapper's app list.
Counts and timestamps only: no message text, ids or keys. Colours: red = down or nobody is told; amber = up but
something needs a look; grey = not deployed. Full write-up: docs/health/INVENTORY.md (EPIC-6 S1).
Raw values: <a href="probe.json">probe.json</a>.</footer></main>
<script>const t=Date.parse("{probed}");function u(){{const m=Math.round((Date.now()-t)/60000);
if(location.hostname==="health.zenod.dev"){{const s=document.getElementById("signin");if(s)s.remove()}}
document.getElementById("age").textContent=" ("+m+" min ago)";if(m>15)document.getElementById("stale").style.display="block"}}u();setInterval(u,30000)</script>
</body></html>"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--remote", action="store_true")
    ap.add_argument("--out")
    ap.add_argument("--from-json")
    a = ap.parse_args()
    if a.remote:
        print(json.dumps(remote()))
        return
    d = json.load(open(a.from_json)) if a.from_json else collect()
    out = os.path.expanduser(a.out or ".")
    os.makedirs(out, exist_ok=True)
    link = None if a.from_json else signin_link()
    for name, body in (("probe.json", json.dumps(d, indent=1)), ("index.html", page(d, link))):
        tmp = os.path.join(out, name + ".tmp")
        with open(tmp, "w") as f:
            f.write(body)
        os.replace(tmp, os.path.join(out, name))
    print(json.dumps({r["name"]: r["colour"] for r in rows(d)}))


if __name__ == "__main__":
    main()
