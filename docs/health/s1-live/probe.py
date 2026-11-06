#!/usr/bin/env python3
"""EPIC-6 S1 live inventory page: one row per component in docs/health/INVENTORY.md.

Runs on VPS3 (systemd --user timer, every 5 min). Read-only: public health endpoints from here, plus one
`ssh hetzner_vps_1 python3 - --remote` that uses only the narrow sudo rules t3agent has on VPS1 (docker
ps/inspect/logs --timestamps, journalctl, tester-watch --redact, the dokploy wrapper's `apps` listing,
the Traefik access log). Output is counts, states and timestamps only: no env, no ids, no message text.

    python3 probe.py --out ~/artifacts/epic6-s1-health      # writes index.html + probe.json (S2: aggregate.py document)
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import timeline  # noqa: E402  (S1 it.5: 7-day strip per row; keep when restructuring the page)
except ImportError:
    timeline = None

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import smoke_view  # noqa: E402  (S3 smoke battery result; absent in --remote mode on VPS1)
except ImportError:
    smoke_view = None

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
CAPTURE_KINDS = ("store", "media_ingest", "enrich_memory")
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
    z = {"lastJob": None, "jobs24h": 0, "lastIndex": None, "lastError": None, "errors24h": 0, "lines": 0,
         "capturesFailingSince": None}
    for t, rest in logs(ZENOD_SVC, week):
        z["lines"] += 1
        m = re.match(r"\[task-job\] \S+ done: (\w+)", rest)
        if m:
            z["lastJob"] = {"at": iso(t), "kind": m.group(1)}
            if t >= day:
                z["jobs24h"] += 1
            if m.group(1) in CAPTURE_KINDS:
                z["capturesFailingSince"] = None
        # ZAL-A8: a save that failed with no save finished after it (kind logged since ZAL-A8; older lines count
        # only when the vault guard refused them)
        m = re.match(r"\[task-job\] \S+ failed(?: \((\w+)\))?:", rest)
        if m and (m.group(1) in CAPTURE_KINDS or (m.group(1) is None and "filing_recovery_pending" in rest)):
            z["capturesFailingSince"] = z["capturesFailingSince"] or iso(t)
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
         "errors24h": 0, "inboundTimes": []}
    for t, rest in logs(PHYLAX_SVC, week):
        if rest.startswith("[whatsapp][diag] markRead"):
            p["lastInbound"] = iso(t)
            p["inboundTimes"] = (p["inboundTimes"] + [iso(t)])[-200:]
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

    # S5 watchdog (user timer) and its sender: every queued alert id (watchdog and this page) must show up as
    # `alert=sent id=<id>` in the relay watchdog's log, which delivers the HQ queue to Jordi's "HQ — vps1 alerts" thread.
    runs = journal("zenod-health-watchdog", "-24h", user=True)
    sent_log = os.path.expanduser("~/agent_team_m0/relay-watchdog.log")
    sent = set()
    try:
        with open(sent_log, "rb") as f:
            f.seek(max(0, os.path.getsize(sent_log) - 3_000_000))
            sent = set(re.findall(r"alert=sent id=(\S+)", f.read().decode("utf-8", "replace")))
    except OSError:
        pass
    queued, undelivered, last_alert, last_sent = [], 0, None, None
    try:
        for line in open(os.path.expanduser("~/.local/state/zenod-alert/alert.log"), errors="replace"):
            m = re.match(r"\[zenod-alert (\S+)\] (.*)", line)
            t = parse_ts(m.group(1)) if m else None
            if not t or t < day:
                continue
            if re.match(r"(ALERT|RECOVERED)\[", m.group(2)):
                last_alert = t
            q = re.search(r"delivery=hq-queue id=(\S+)", m.group(2))
            if q:
                queued.append(q.group(1))
                if q.group(1) in sent:
                    last_sent = t
                elif (t_now - t).total_seconds() > 600:
                    undelivered += 1
            elif "delivery=no" in m.group(2):
                undelivered += 1
    except OSError:
        pass
    out["watchdog"] = {
        "alerts24h": len(queued), "deliveredYes24h": sum(1 for i in queued if i in sent),
        "deliveredNo24h": undelivered, "lastAlert": iso(last_alert), "lastDelivered": iso(last_sent),
        "timer": sh(["systemctl", "--user", "show", "zenod-health-watchdog.timer", "-p", "ActiveState",
                     "--value"]).strip(),
        "lastRun": iso(runs[-1][0]) if runs else None,
        "retiredRootTimer": sh(["systemctl", "show", "zenod-watchdog.timer", "-p", "ActiveState", "--value"]).strip(),
    }

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
                              "main", "--status", "success", "-L", "20", "--json", "headSha,createdAt"]))
        import aggregate
        d["publish"] = aggregate.newest_publish(runs)
    except Exception:
        d["publish"] = None
    if smoke_view:  # S4: the latest smoke result, folded into each row's status by aggregate.merge_smoke()
        import aggregate
        d["smoke"] = aggregate.smoke_summary(smoke_view.load(keep=1)[0])
    src = open(os.path.abspath(__file__)).read()
    r = sh(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "hetzner_vps_1", "python3", "-", "--remote"],
           timeout=300, stdin=src)
    try:
        d["vps1"] = json.loads(r)
    except Exception:
        d["vps1"] = {"error": "ssh/remote probe failed"}
    return d


# --------------------------------------------------------------------------------------------- page (S2: rendered from the aggregate document)

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
h2{font:600 18px Georgia,serif;margin:22px 0 6px}ul.tr{margin:0;padding-left:18px;color:#444}
.hist{color:#777;font-size:12.5px}.why{display:block;margin-top:4px;font-weight:400;font-size:12.5px;color:var(--r)}footer{margin-top:16px;color:#666;font-size:12.5px}code{font-size:12.5px}
"""


def page(doc: dict, link: dict | None = None) -> str:
    from aggregate import ago, parse_ts
    ref = parse_ts(doc["checked_at"])
    signin = ""
    if link:
        until = dt.datetime.fromtimestamp(link["exp"], UTC).strftime("%d %b")
        u = html.escape(link["url"])
        signin = (f'<div id="signin">Open this page on any device: <a href="{u}">sign in to health.zenod.dev</a>. '
                  f'The link works once, until {until}, and your browser then stays signed in while you use it. '
                  f'If you have no password yet, it asks you to set one first. Lost your password? Use this link, '
                  f'then set a new one.</div>')
    counts = doc["summary"]
    tlv = timeline.load_view() if timeline else None
    smoke, smoke_hist = smoke_view.load()  # S3 smoke column (keep when restructuring the page)
    tr = []
    for c in doc["components"]:
        nm = html.escape(c["name"])
        if c.get("link"):
            nm = f'<a href="{html.escape(c["link"])}">{nm}</a>'
        st = c["status"]
        la = c.get("last_activity")
        act = html.escape(c["activity"])
        if la and la.get("from_history"):
            act += f'<br><span class="hist">kept from before: last seen {html.escape(ago(la["at"], ref))}</span>'
        le = c.get("last_error")
        if le:
            err = (f'<b>{html.escape(le["what"])}</b><br>{html.escape(ago(le["at"], ref))}'
                   + (f', first seen {html.escape(ago(le["first_seen"], ref))}' if le["first_seen"] != le["at"] else "")
                   + f'<br><span class="hist">from {html.escape(le["source"])}</span>')
        else:
            err = "none recorded"
        err += f'<br><span class="hist">now: {html.escape(c["error_now"])}</span>'
        tr.append(
            f'<tr id="{c["id"]}"><td class="c {st}"><span></span></td><td class="name">{nm}<br>'
            f'<span class="st {st}">{st}</span><br><span class="hist">since {html.escape(ago(c["status_since"], ref))}</span>'
            + (f'<br><span class="why">{html.escape(c["problem"])}</span>' if st in ("amber", "red") and c.get("problem") else "")
            + f'</td>{timeline.cell(c["id"], tlv, ref) if timeline else ""}<td class="where">{html.escape(c["where"])}</td>'
            f'<td>{html.escape(c["signal"])}<br><span class="hist">checked {html.escape(ago(c["checked_at"], ref))}</span></td>'
            f'<td>{act}</td><td>{err}</td><td class="tests">{smoke_view.cell(smoke, c["id"])}{html.escape(c["tests"])}</td></tr>')
    probed = doc["checked_at"]
    since = (doc.get("history_since") or probed).replace("T", " ").replace("Z", " UTC")
    trs = "".join(
        f'<li>{html.escape(ago(t["at"], ref))}: {html.escape(t["name"])} {t["from"]} → <b>{t["to"]}</b>'
        f' ({html.escape(t["reason"] or "")})</li>' for t in (doc.get("transitions") or [])[::-1][:10])
    trs = f"<h2>Recent changes</h2><ul class=\"tr\">{trs}</ul>" if trs else ""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="60">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Zenod health · live</title>
<style>{CSS}{timeline.CSS if timeline else ''}{smoke_view.CSS}</style></head><body><main>
{signin}
<div id="stale">This page is stale: the last probe is more than 15 minutes old.</div>
<h1>Zenod health, live</h1>
<p class="sub">Every part of Zenod, where it runs, and what it says right now. Checked <b>{probed.replace('T', ' ').replace('Z', ' UTC')}</b>
<span id="age"></span>, every 5 minutes, read-only. Last errors are kept by this page since {since}, so they survive a redeploy.
Behind a password at health.zenod.dev; also on the tailnet.
<a href="https://health.zenod.dev/password">Set or change your password</a>.</p>
{smoke_view.banner(smoke, smoke_hist)}
<div class="sum"><span class="pill">🟢 {counts['green']} green</span><span class="pill">🟠 {counts['amber']} amber</span>
<span class="pill">🔴 {counts['red']} red</span><span class="pill">⚪ {counts['grey']} not deployed</span></div>
<table><thead><tr><th></th><th>Component</th>{timeline.header(ref) if timeline else ''}<th>Where it runs</th><th>Health signal, live</th><th>Last real activity</th>
<th>Last error</th><th>Smoke result and test battery</th></tr></thead><tbody>
{''.join(tr)}
</tbody></table>
{trs}
<footer>Sources: public <code>/api/health</code> endpoints from VPS3; on VPS1 the Traefik access log, container logs
(since each container started), systemd journals, <code>tester-watch --redact</code> and the Dokploy wrapper's app list.
Counts and timestamps only: no message text, ids or keys. Colours: red = down or nobody is told, or a smoke check
for that part failed in the last 45 min (S4); amber = up but something needs a look; grey = not deployed. A red row (and the host watchdog's own checks) goes to Jordi's
"HQ — vps1 alerts" thread once, again every 30 min while red, and once when it recovers (S5). Write-up: docs/health/INVENTORY.md (EPIC-6 S1), aggregator EPIC-6 S2.
The same values as one JSON document: <a href="probe.json">probe.json</a>.</footer></main>
<script>const t=Date.parse("{probed}");function u(){{const m=Math.round((Date.now()-t)/60000);
if(location.hostname==="health.zenod.dev"){{const s=document.getElementById("signin");if(s)s.remove()}}
document.getElementById("age").textContent=" ("+m+" min ago)";if(m>15)document.getElementById("stale").style.display="block"}}u();setInterval(u,30000)</script>
</body></html>"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--remote", action="store_true")
    ap.add_argument("--out")
    ap.add_argument("--from-json", help="a saved raw probe (or a v1 document's raw); no state unless --state")
    ap.add_argument("--state", help="history file (default ~/.local/state/zenod-health/history.json)")
    ap.add_argument("--no-alert", action="store_true", help="do not send red components to the HQ alert queue (S5)")
    a = ap.parse_args()
    if a.remote:
        print(json.dumps(remote()))
        return
    import aggregate
    if a.from_json:
        raw = json.load(open(a.from_json))
        raw = raw.get("raw", raw)
    else:
        raw = collect()
    state_path = a.state or (None if a.from_json else aggregate.STATE)
    state = aggregate.load_state(state_path) if state_path else aggregate.load_state("/nonexistent")
    doc, state = aggregate.aggregate(raw, state)
    if state_path:
        aggregate.save_state(state, state_path)
    if timeline and not a.from_json:
        timeline.record(doc)
    out = os.path.expanduser(a.out or ".")
    os.makedirs(out, exist_ok=True)
    link = None if a.from_json else signin_link()
    files = [("probe.json", json.dumps(doc, indent=1)), ("index.html", page(doc, link))]
    smoke, _ = smoke_view.load()
    if smoke:
        files.append(("smoke.json", json.dumps(smoke, indent=1)))
    for name, body in files:
        tmp = os.path.join(out, name + ".tmp")
        with open(tmp, "w") as f:
            f.write(body)
        os.replace(tmp, os.path.join(out, name))
    if not a.from_json and not a.no_alert:
        alert_red(doc)
    print(json.dumps({c["id"]: c["status"] for c in doc["components"]}))


def alert_red(doc: dict) -> None:
    """EPIC-6 S5: send red components to Jordi through the watchdog's sender on VPS1 (HQ alert queue, same dedupe
    and row keys as the watchdog, one RECOVERED when a component is no longer red). The watchdog row is the sender
    itself, so it is left out; a failed VPS1 read is not turned into alerts (the watchdog on VPS1 runs on its own)."""
    if (doc.get("raw", {}).get("vps1") or {}).get("error"):
        return
    payload = [{"key": f"row-{c['n']}", "name": c["name"], "colour": c["status"], "signal": c["problem"] or c["signal"]}
               for c in doc["components"] if c["id"] != "watchdog"]
    out = sh(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "hetzner_vps_1",
              "ZENOD_ALERT_SOURCE='zenod health page' ~/.local/share/zenod-watchdog/zenod-alert.sh rows"],
             timeout=60, stdin=json.dumps(payload))
    for line in out.splitlines():
        print(line, file=sys.stderr)


if __name__ == "__main__":
    main()
