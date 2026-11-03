#!/usr/bin/env python3
"""EPIC-6 S1 iteration 5: a 7-day timeline per component on the health page.

Two compact stores on VPS3 (0600, ~/.local/state/zenod-health/), one writer each:

- samples.json (written by probe.py every 5 min through record()): the status of every component per probe run,
  kept at 5-min resolution for 24 h and rolled up to the worst status per hour for 8 days, plus probe-only numbers
  (METRICS[...]["probe"]) as the last value per hour.
- hours.json (written by `timeline.py collect`, systemd --user timer every 15 min): one bucket per component and UTC
  hour with the key number and, where a log states it, a status rebuilt from that log. It runs this file on VPS1 as
  `python3 - --remote-hours SINCE` with the same narrow read-only sudo rules as the probe (Traefik access log,
  docker logs --timestamps, journals, the S5 alert log). Counts, durations, statuses and timestamps only.

`timeline.py backfill` = collect over 7 days plus the probe statuses already in the probe service's journal (VPS3,
since the page went live). Hours no source covers stay empty and the strip shows them as a gap.

    python3 timeline.py collect            # last 3 h (timer)
    python3 timeline.py backfill           # last 7 days, once
    python3 timeline.py show               # coverage per component, for humans
"""

from __future__ import annotations

import datetime as dt
import html
import json
import os
import re
import subprocess
import sys

UTC = dt.timezone.utc
STATE_DIR = os.path.expanduser("~/.local/state/zenod-health")
SAMPLES = os.path.join(STATE_DIR, "samples.json")
HOURS = os.path.join(STATE_DIR, "hours.json")
DAYS, SAMPLE_HOURS = 7, 24
RANK = {"grey": 0, "green": 1, "amber": 2, "red": 3}
PROBE_UNIT = "epic6-s1-health-probe.service"

# key number per component: label, unit, how it is drawn, and where its history comes from
METRICS = {
    "site": {"label": "visits per hour", "kind": "bars", "src": "Traefik access log, real requests to zenod.dev"},
    "cloud": {"label": "median response", "unit": "ms", "kind": "line",
              "src": "Traefik access log, every request to cloud.zenod.dev"},
    "database": {"label": "jobs stored per hour", "kind": "bars", "src": "zenod-mt container log, task jobs done"},
    "phylax": {"label": "WhatsApp messages in per hour", "kind": "bars", "src": "Phylax container log"},
    "agent_runner": {"label": None, "src": None},
    "memory_index": {"label": "index build", "unit": "ms", "kind": "line", "src": "zenod-mt container log"},
    "deploy": {"label": "deploys rolled per hour", "kind": "bars", "src": "deploy poller journal"},
    "watchdog": {"label": "alerts raised per hour", "kind": "bars",
                 "src": "watchdog journal, then the S5 alert log"},
    "readiness": {"label": "days until a proof expires", "kind": "line", "src": "readiness watch journal"},
    "tester_watch": {"label": "testers signed up", "kind": "line", "probe": "signedUp",
                     "src": "this page's probe"},
    "ingress": {"label": "tunnel error lines per hour", "kind": "bars", "src": "cloudflared journal"},
    "host": {"label": "root disk used", "unit": "%", "kind": "line", "top": 100, "src": "disk guard journal"},
}
# which components get a status rebuilt from a log, and the rule, in plain words for the page
LOG_STATUS = {
    "site": "answered without server errors, amber when some requests got a 5xx",
    "cloud": "answered without server errors, amber when some requests got a 5xx",
    "phylax": "answered without server errors, amber when some requests got a 5xx",
    "memory_index": "green when an index was built",
    "deploy": "green when the poller ran and was up to date or rolled, amber on a skip, red when it did not run",
    "watchdog": "red while alerts went nowhere, green once they were delivered",
    "readiness": "green when ready, amber when a proof expires within 7 days, red when not ready",
    "host": "the disk guard's own OK, WARN or CRIT",
}


def now() -> dt.datetime:
    return dt.datetime.now(UTC)


def iso(t: dt.datetime | None) -> str | None:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if t else None


def parse_ts(s) -> dt.datetime | None:
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
    return (base - sign * dt.timedelta(hours=int(tz[1:3]), minutes=int(tz[-2:]))).replace(tzinfo=UTC)


def hkey(t: dt.datetime) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H")


def hstart(k: str) -> dt.datetime:
    return dt.datetime.strptime(k, "%Y-%m-%dT%H").replace(tzinfo=UTC)


def sh(cmd: list[str], timeout: int = 120, stdin: str | None = None) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, input=stdin).stdout
    except Exception:
        return ""


def load(path: str) -> dict:
    try:
        return json.load(open(path))
    except (OSError, ValueError):
        return {}


def save(obj: dict, path: str) -> None:
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    tmp = path + ".tmp"
    with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    os.replace(tmp, path)


def worst(a: str | None, b: str | None) -> str | None:
    if a is None:
        return b
    if b is None:
        return a
    return a if RANK.get(a, 0) >= RANK.get(b, 0) else b


# --------------------------------------------------------------------------------------------- probe samples (VPS3)

def add_sample(st: dict, cid: str, t: dt.datetime, status: str, value=None) -> None:
    st.setdefault("samples", {}).setdefault(cid, []).append([iso(t), status])
    h = st.setdefault("hours", {}).setdefault(cid, {}).setdefault(hkey(t), {})
    h["s"] = worst(h.get("s"), status)
    if value is not None:
        h["v"] = value
    st["since"] = min(st.get("since") or iso(t), iso(t))


def trim_samples(st: dict, ref: dt.datetime) -> None:
    cut, hcut = iso(ref - dt.timedelta(hours=SAMPLE_HOURS)), hkey(ref - dt.timedelta(days=DAYS + 1))
    for cid, xs in st.get("samples", {}).items():
        st["samples"][cid] = sorted({x[0]: x for x in xs if x[0] >= cut}.values())
    for cid, hs in st.get("hours", {}).items():
        st["hours"][cid] = {k: v for k, v in hs.items() if k >= hcut}


def record(doc: dict, path: str = SAMPLES) -> None:
    """Called by probe.py after each aggregate: one status sample per component."""
    t = parse_ts(doc.get("checked_at")) or now()
    st = load(path)
    for c in doc["components"]:
        pm = METRICS.get(c["id"], {}).get("probe")
        add_sample(st, c["id"], t, c["status"], (c.get("signal_value") or {}).get(pm) if pm else None)
    trim_samples(st, t)
    save(st, path)


def backfill_probe_journal(doc: dict, path: str = SAMPLES) -> int:
    """The probe service prints one {component: status} line per run (keyed by name before S2, by id after)."""
    ids = {c["name"]: c["id"] for c in doc["components"]} | {c["id"]: c["id"] for c in doc["components"]}
    st, n = load(path), 0
    out = sh(["journalctl", "--user", "-u", PROBE_UNIT, "--since", f"-{DAYS}d", "--no-pager", "-o", "short-iso"])
    for line in out.splitlines():
        t, _, rest = line.partition(" ")
        body = rest.split(": ", 1)[-1] if "python3[" in rest else ""
        if not body.startswith("{"):
            continue
        try:
            j = json.loads(body)
        except ValueError:
            continue
        ts = parse_ts(t)
        for k, s in j.items():
            if k in ids and s in RANK and ts:
                add_sample(st, ids[k], ts.replace(second=0), s)
                n += 1
    trim_samples(st, now())
    save(st, path)
    return n


# --------------------------------------------------------------------------------------------- log hours (runs on VPS1)

ZENOD_SVC = "zenod-mt-fxpzoo"
PHYLAX_SVC = "app-index-back-end-panel-6zm3qg"
TRAEFIK = "/etc/dokploy/traefik/dynamic"


def remote_hours(since: dt.datetime) -> dict:
    """Per component: {"from": ISO first moment the source covers, "h": {hour: {"v": n, "s": status?}}}."""
    sudo = ["sudo", "-n"]
    t_now = now()
    out: dict = {"at": iso(t_now)}

    def comp(cid: str) -> dict:
        return out.setdefault(cid, {"from": None, "h": {}})

    def cover(cid: str, t: dt.datetime | None) -> None:
        c = comp(cid)
        if t and (c["from"] is None or iso(t) < c["from"]):
            c["from"] = iso(max(t, since))

    def bucket(cid: str, t: dt.datetime) -> dict:
        return comp(cid)["h"].setdefault(hkey(t), {})

    def zero_fill(cid: str, start: dt.datetime | None) -> None:
        if not start:
            return
        t = max(start, since).replace(minute=0, second=0, microsecond=0)
        while t <= t_now:
            bucket(cid, t).setdefault("v", 0)
            t += dt.timedelta(hours=1)

    # Traefik access log (current file plus any rotated ones the sudo rules allow)
    files = [f for f in sh(sudo + ["ls", TRAEFIK]).split() if re.fullmatch(r"access\.log(\.\d+)?(\.gz)?", f)]
    hosts = {"zenod.dev": "site", "cloud.zenod.dev": "cloud", "phylax.zenod.dev": "phylax"}
    durs: dict[tuple[str, str], list[float]] = {}
    first = None
    for f in sorted(files, reverse=True):
        p = f"{TRAEFIK}/{f}"
        raw = sh(sudo + (["zcat", p] if f.endswith(".gz") else ["cat", p]), timeout=120)
        for line in raw.splitlines():
            if '"RequestHost":"' not in line:
                continue
            try:
                j = json.loads(line)
            except ValueError:
                continue
            t = parse_ts(j.get("StartUTC"))
            if not t:
                continue
            first = t if first is None or t < first else first
            cid = hosts.get(j.get("RequestHost"))
            if not cid or t < since:
                continue
            b = bucket(cid, t)
            status = int(j.get("DownstreamStatus") or 0)
            b["s"] = worst(b.get("s"), "amber" if status >= 500 else ("green" if 0 < status < 500 else None))
            if cid == "site" and not (j.get("RequestPath") or "").startswith("/api/health"):
                b["v"] = b.get("v", 0) + 1
            if cid == "cloud" and j.get("Duration") is not None:
                durs.setdefault((cid, hkey(t)), []).append(float(j["Duration"]) / 1e6)
    for cid in hosts.values():
        cover(cid, first)
    zero_fill("site", first)
    for (cid, k), xs in durs.items():
        xs.sort()
        out[cid]["h"][k]["v"] = round(xs[len(xs) // 2], 1)

    # container logs (only since each running container started: docker drops a container's log on redeploy)
    ids = sh(sudo + ["docker", "ps", "-aq", "--no-trunc"]).split()
    fmt = "{{.Id}}|{{.Name}}|{{.RestartCount}}|{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}|{{json .State}}"
    started = {}
    for line in (sh(sudo + ["docker", "inspect", "--format", fmt] + ids).splitlines() if ids else []):
        p = line.split("|", 5)
        if len(p) < 6:
            continue
        for svc in (ZENOD_SVC, PHYLAX_SVC):
            if p[1].lstrip("/").startswith(svc + "."):
                s = json.loads(p[5])
                if s.get("Running"):
                    started[svc] = (p[0], parse_ts(s.get("StartedAt")))

    def logs(svc: str):
        if svc not in started:
            return None, []
        cid_, st_ = started[svc]
        s = max(since, (st_ or since) - dt.timedelta(seconds=1))
        raw = sh(sudo + ["docker", "logs", "--since", iso(s), "--until", iso(t_now), "--timestamps", cid_], timeout=120)
        res = []
        for line in raw.splitlines():
            ts, _, rest = line.partition(" ")
            t = parse_ts(ts)
            if t:
                res.append((t, rest))
        return st_, res

    st_, zl = logs(ZENOD_SVC)
    cover("database", st_), cover("memory_index", st_)
    zero_fill("database", st_)
    ms: dict[str, list[float]] = {}
    for t, rest in zl:
        if re.match(r"\[task-job\] \S+ done: \w+", rest):
            b = bucket("database", t)
            b["v"] = b.get("v", 0) + 1
        m = re.match(r"\[memory-search\] tier-0 index, ([\d.]+) ms", rest)
        if m:
            ms.setdefault(hkey(t), []).append(float(m.group(1)))
            bucket("memory_index", t)["s"] = "green"
    for k, xs in ms.items():
        xs.sort()
        out["memory_index"]["h"][k]["v"] = round(xs[len(xs) // 2])

    st_, pl = logs(PHYLAX_SVC)
    cover("phylax", st_)
    zero_fill("phylax", st_)
    for t, rest in pl:
        if rest.startswith("[whatsapp][diag] markRead"):
            b = bucket("phylax", t)
            b["v"] = b.get("v", 0) + 1
    # phylax.zenod.dev coverage: the earlier of the container log and the access log
    if out["phylax"].get("from") and first:
        out["phylax"]["from"] = iso(max(since, min(first, st_ or first)))

    def journal(unit: str, user: bool = False) -> list[tuple[dt.datetime, str]]:
        cmd = (["journalctl", "--user"] if user else sudo + ["journalctl"]) + \
            ["-u", unit, "--since", f"@{int(since.timestamp())}", "--no-pager", "-o", "short-iso"]
        res = []
        for line in sh(cmd, timeout=120).splitlines():
            t = parse_ts(line.split(" ", 1)[0])
            if t and "systemd[" not in line and "sudo[" not in line:
                res.append((t, line.split(": ", 1)[-1]))
        return res

    # deploy poller: every run is a line; the last line of an hour sets its status like the S2 rule
    dp = [x for x in journal("infra-vps-deploy-poller", user=True) if "deploy-poller zenod-mt" in x[1]]
    cover("deploy", dp[0][0] if dp else None)
    zero_fill("deploy", dp[0][0] if dp else None)
    for t, m in dp:
        b = bucket("deploy", t)
        b["s"] = "green" if ("noop" in m or "roll" in m) else "amber"
        if "deploy rolled" in m:
            b["v"] = b.get("v", 0) + 1
    if dp:  # an hour inside the covered span with no poller line at all is red (the poller did not run)
        for k, b in out["deploy"]["h"].items():
            if "s" not in b and hstart(k) + dt.timedelta(hours=1) <= t_now:
                b["s"] = "red"

    # watchdog: the retired root timer (alerts went nowhere), then the S5 user timer and its delivery log
    old = journal("zenod-watchdog")
    new = journal("zenod-health-watchdog", user=True)
    switch = new[0][0] if new else None
    cover("watchdog", old[0][0] if old else switch)
    zero_fill("watchdog", old[0][0] if old else switch)
    for t, m in old:
        if switch and t >= switch:
            break
        b = bucket("watchdog", t)
        if "ALERT[" in m:
            b["v"] = b.get("v", 0) + 1
        if "delivery=no" in m:
            b["s"] = "red"
    for t, m in new:
        b = bucket("watchdog", t)
        b["s"] = b.get("s") or "green"
    try:
        for line in open(os.path.expanduser("~/.local/state/zenod-alert/alert.log"), errors="replace"):
            m = re.match(r"\[zenod-alert (\S+)\] (ALERT|RECOVERED)\[", line)
            t = parse_ts(m.group(1)) if m else None
            if t and t >= since:
                b = bucket("watchdog", t)
                b["v"] = b.get("v", 0) + 1
    except OSError:
        pass

    # readiness watch: ready flag and the soonest proof expiry
    rw = [x for x in journal("zenod-readiness-watch") if "watch ready=" in x[1]]
    cover("readiness", rw[0][0] if rw else None)
    for t, m in rw:
        mm = re.search(r"ready=(\w+) issues=(\[.*?\]) proofs=(\[.*\])", m)
        if not mm:
            continue
        try:
            mind = min((p["daysLeft"] for p in json.loads(mm.group(3))), default=None)
        except (ValueError, KeyError, TypeError):
            mind = None
        b = bucket("readiness", t)
        b["s"] = "red" if mm.group(1) != "True" else ("amber" if mind is not None and mind <= 7 else "green")
        if mind is not None:
            b["v"] = round(mind, 1)

    # cloudflared: error lines per hour (status stays the probe's: the rule is "service active")
    cf = journal("cloudflared-vps1-sites")
    cover("ingress", cf[0][0] if cf else None)
    zero_fill("ingress", cf[0][0] if cf else None)
    for t, m in cf:
        if " ERR " in m:
            b = bucket("ingress", t)
            b["v"] = b.get("v", 0) + 1

    # disk guard: pct and its own level
    dg = [x for x in journal("infra-vps-disk-guard", user=True) if "pct=" in x[1]]
    cover("host", dg[0][0] if dg else None)
    for t, m in dg:
        mm = re.search(r"level=(\w+) pct=([\d.]+)", m)
        if mm:
            b = bucket("host", t)
            b["v"] = max(b.get("v", 0), round(float(mm.group(2)), 1))
            b["s"] = worst(b.get("s"), {"OK": "green", "WARN": "amber", "CRIT": "red"}.get(mm.group(1)))

    out["traefik_from"] = iso(first)
    return out


# --------------------------------------------------------------------------------------------- collect (VPS3)

def collect(hours_back: int, path: str = HOURS) -> dict:
    since = (now() - dt.timedelta(hours=hours_back)).replace(minute=0, second=0, microsecond=0)
    src = open(os.path.abspath(__file__)).read()
    r = sh(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "hetzner_vps_1", "python3", "-",
            "--remote-hours", iso(since)], timeout=600, stdin=src)
    try:
        got = json.loads(r)
    except ValueError:
        print("remote read failed", file=sys.stderr)
        return {}
    st = load(path)
    st.setdefault("h", {})
    st.setdefault("from", {})
    for cid in METRICS:
        g = got.get(cid)
        if not g or not g.get("from"):
            continue
        frm = parse_ts(g["from"])
        if not st["from"].get(cid) or g["from"] < st["from"][cid]:
            st["from"][cid] = g["from"]
        hs = st["h"].setdefault(cid, {})
        for k, b in g["h"].items():
            if hstart(k) < frm.replace(minute=0, second=0) or (hstart(k) < frm and k in hs):
                # the source only covers part of this hour now (log reset by a redeploy, rotation): keep the fuller one
                old = hs.get(k, {})
                b = {"v": max(x for x in (old.get("v"), b.get("v")) if x is not None)
                     if old.get("v") is not None or b.get("v") is not None else None,
                     "s": worst(old.get("s"), b.get("s"))}
                b = {kk: vv for kk, vv in b.items() if vv is not None}
            hs[k] = b
    cut = hkey(now() - dt.timedelta(days=DAYS + 1))
    for cid in st["h"]:
        st["h"][cid] = {k: v for k, v in st["h"][cid].items() if k >= cut}
    st["at"] = got.get("at")
    st["traefik_from"] = got.get("traefik_from")
    save(st, path)
    return st


# --------------------------------------------------------------------------------------------- render

W_H, BAND, CH = 2, 7, 24          # px per hour, status band height, number chart height
LIGHT = {"green": "#9cc9a9", "amber": "#e5bd78", "red": "#e3938d", "grey": "#d6d3cc"}
SOLID = {"green": "#1f7a3f", "amber": "#b26b00", "red": "#b3261e", "grey": "#b9b6ae"}
CSS = """
main{max-width:1760px}td.tl{width:360px;min-width:360px}td.tl svg{display:block}.tlc{color:#555;font-size:12px;line-height:1.35;margin-top:3px}
th.tl{width:360px}th.tl svg{display:block;margin-top:4px}.tll{display:inline-block;width:10px;height:8px;margin:0 3px 0 8px;vertical-align:middle;border:1px solid #ccc}
"""


def _fmt(v, unit: str | None) -> str:
    if v is None:
        return "none"
    if isinstance(v, float) and v >= 100:
        v = round(v)
    return f"{v:g} {unit}" if unit else f"{v:g}"


def _window(ref: dt.datetime) -> list[str]:
    end = ref.replace(minute=0, second=0, microsecond=0)
    return [hkey(end - dt.timedelta(hours=i)) for i in range(DAYS * 24 - 1, -1, -1)]


def load_view() -> tuple[dict, dict]:
    return load(SAMPLES), load(HOURS)


def axis(ref: dt.datetime) -> str:
    """Day labels for the column header (UTC)."""
    hs = _window(ref)
    w = len(hs) * W_H
    parts = []
    for i, k in enumerate(hs):
        if k.endswith("T00"):
            x = i * W_H
            parts.append(f'<line x1="{x}" y1="0" x2="{x}" y2="12" stroke="#bbb"/>'
                         f'<text x="{x + 2}" y="10" font-size="9" fill="#777">{hstart(k).strftime("%a %d")}</text>')
    return f'<svg width="{w}" height="12" viewBox="0 0 {w} 12">{"".join(parts)}</svg>'


def legend() -> str:
    return (f'<span class="tll" style="background:{SOLID["green"]}"></span>probed'
            f'<span class="tll" style="background:{LIGHT["green"]}"></span>rebuilt from logs'
            f'<span class="tll" style="background:repeating-linear-gradient(45deg,#ece9e2 0 2px,#fff 2px 4px)"></span>'
            f'no history')


def strip(cid: str, view: tuple[dict, dict], ref: dt.datetime) -> str:
    samples, hours = view
    m = METRICS.get(cid, {})
    hs = _window(ref)
    w = len(hs) * W_H
    ph = (samples.get("hours") or {}).get(cid, {})
    lh = (hours.get("h") or {}).get(cid, {})
    lfrom = (hours.get("from") or {}).get(cid)
    pfrom = samples.get("since")
    # status band: probe status wins, else the log-rebuilt one, else a gap
    segs, cur = [], None
    for i, k in enumerate(hs):
        if ph.get(k, {}).get("s"):
            key = ("p", ph[k]["s"])
        elif lh.get(k, {}).get("s"):
            key = ("l", lh[k]["s"])
        else:
            key = ("n", None)
        if cur and cur[0] == key:
            cur[2] = i + 1
        else:
            cur = [key, i, i + 1]
            segs.append(cur)
    band = []
    for (kind, s), a, b in segs:
        t0, t1 = hstart(hs[a]), hstart(hs[b - 1]) + dt.timedelta(hours=1)
        what = {"p": f"{s}, probed", "l": f"{s}, rebuilt from logs", "n": "no history"}[kind]
        tip = f'{t0.strftime("%a %d %H:00")}–{t1.strftime("%a %d %H:00")} UTC: {what}'
        fill = SOLID[s] if kind == "p" else LIGHT[s] if kind == "l" else "url(#gap)"
        band.append(f'<rect x="{a * W_H}" y="0" width="{(b - a) * W_H}" height="{BAND}" fill="{fill}">'
                    f'<title>{html.escape(tip)}</title></rect>')
    # number: probe value (tester watch) or the log rollup
    vals = []
    for k in hs:
        v = ph.get(k, {}).get("v") if m.get("probe") else lh.get(k, {}).get("v")
        vals.append(v)
    nums = [v for v in vals if v is not None]
    chart = ""
    y0 = BAND + 3
    if m.get("label"):
        top = m.get("top") or (max(nums) if nums else 0)
        lo = 0 if m.get("kind") == "bars" or not nums else min(0, min(nums))
        span = (top - lo) or 1
        gaps = []
        cov = pfrom if m.get("probe") else lfrom
        covk = hkey(parse_ts(cov)) if cov else "9999"
        for i, v in enumerate(vals):
            if v is None and hs[i] < covk:  # before the source's history starts (an hour with no event is just empty)
                gaps.append(f'<rect x="{i * W_H}" y="{y0}" width="{W_H}" height="{CH}" fill="url(#gap)"/>')
        chart += "".join(gaps)
        if m.get("kind") == "bars":
            chart += "".join(
                f'<rect x="{i * W_H}" y="{y0 + CH - max(1, (v - lo) / span * CH) if v else y0 + CH - 0.5:.1f}" '
                f'width="{W_H - 0.3}" height="{max(1, (v - lo) / span * CH) if v else 0.5:.1f}" fill="#4a4a46"/>'
                for i, v in enumerate(vals) if v is not None)
        else:
            run, lines = [], []
            for i, v in enumerate(vals + [None]):
                if v is None:
                    if run:
                        lines.append(run)
                    run = []
                else:
                    run.append(f"{i * W_H + W_H / 2:.1f},{y0 + CH - (v - lo) / span * (CH - 2) - 1:.1f}")
            for r in lines:
                if len(r) == 1:
                    x, y = r[0].split(",")
                    chart += f'<circle cx="{x}" cy="{y}" r="1.6" fill="#1d1d1b"/>'
                else:
                    chart += f'<polyline points="{" ".join(r)}" fill="none" stroke="#1d1d1b" stroke-width="1.2"/>'
    days = "".join(f'<line x1="{i * W_H}" y1="0" x2="{i * W_H}" y2="{y0 + CH}" stroke="#fff" stroke-width="0.6"/>'
                   for i, k in enumerate(hs) if k.endswith("T00") and i)
    h = y0 + CH if m.get("label") else BAND
    svg = (f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="last 7 days">'
           f'<defs><pattern id="gap" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
           f'<rect width="4" height="4" fill="#fff"/><rect width="2" height="4" fill="#ece9e2"/></pattern></defs>'
           f'{"".join(band)}{chart}{days}</svg>')
    cap = []
    if m.get("label"):
        last = next((v for v in reversed(vals) if v is not None), None)
        cap.append(f'{html.escape(m["label"])}: now {_fmt(last, m.get("unit"))}, 7-day max '
                   f'{_fmt(max(nums) if nums else None, m.get("unit"))}')
    starts = []
    if lfrom and m.get("src") and not m.get("probe"):
        starts.append(f'{m["src"]} from {_day(lfrom)}')
    if pfrom:
        starts.append(f'probe from {_day(pfrom)}')
    if not m.get("label"):
        starts.append("no number: nothing runs")
    cap.append("history: " + ("; ".join(starts) if starts else "none yet"))
    return svg + f'<div class="tlc">{"<br>".join(cap)}</div>'


def _day(s: str) -> str:
    t = parse_ts(s)
    return t.strftime("%a %d %b %H:%M UTC") if t else s


def cell(cid: str, view: tuple[dict, dict], ref: dt.datetime) -> str:
    try:
        return f'<td class="tl">{strip(cid, view, ref)}</td>'
    except Exception as e:  # never break the page for the strip
        return f'<td class="tl"><span class="tlc">timeline unavailable ({type(e).__name__})</span></td>'


def header(ref: dt.datetime) -> str:
    return f'<th class="tl">Last 7 days, UTC<br><span style="text-transform:none;letter-spacing:0">{legend()}</span>{axis(ref)}</th>'


# --------------------------------------------------------------------------------------------- cli

def show() -> None:
    samples, hours = load_view()
    print("probe samples since", samples.get("since"))
    for cid in METRICS:
        lh = (hours.get("h") or {}).get(cid, {})
        ph = (samples.get("hours") or {}).get(cid, {})
        print(f"{cid:13} logs from {(hours.get('from') or {}).get(cid)}  log hours {len(lh):3}  "
              f"with number {sum(1 for b in lh.values() if 'v' in b):3}  with status {sum(1 for b in lh.values() if 's' in b):3}"
              f"  probe hours {len(ph):3}")


def main(argv: list[str]) -> int:
    if argv[:1] == ["--remote-hours"]:
        print(json.dumps(remote_hours(parse_ts(argv[1]))))
        return 0
    cmd = argv[0] if argv else "show"
    if cmd == "collect":
        collect(3)
    elif cmd == "backfill":
        doc = json.load(open(os.path.expanduser("~/artifacts/epic6-s1-health/probe.json")))
        print("probe samples from journal:", backfill_probe_journal(doc))
        collect(DAYS * 24 + 1)
    show()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
