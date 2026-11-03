"""EPIC-6 S3: the smoke battery's result on the health page.

`scripts/smoke-prod.mjs` (`npm run smoke:prod`) runs every 15 min on VPS3 (user timer zenod-smoke-prod) and writes
SMOKE_DIR/latest.json plus SMOKE_DIR/runs/<stamp>.json (last 96 kept); shape in docs/health/SMOKE.md. This module only
reads those files and renders HTML; probe.py calls it with each row's component id. Stdlib only.
"""

from __future__ import annotations

import html
import json
import os

SMOKE_DIR = os.path.expanduser("~/.local/share/zenod-health/smoke")
# Row number -> component id, for pages that still key rows by number (S1 probe.py before the S2 aggregate).
ROW_ID = {"1": "site", "2": "cloud", "3": "database", "4": "phylax", "5": "agent_runner", "6": "memory_index",
          "7": "deploy", "8": "watchdog", "9": "readiness", "10": "tester_watch", "11": "ingress", "12": "host"}

CSS = """
.smoke{color:#222;margin-bottom:6px}.smh{color:#666;font-size:12px}.sm{font-weight:700;padding:0 4px;border-radius:3px}
.sm.pass{color:#0a6b2c;background:#e3f5e8}.sm.fail{color:#fff;background:#c62828}.ms{color:#888;font-size:11.5px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin:0 1px;vertical-align:middle}
.dot.pass{background:#2e9d50}.dot.fail{background:#c62828}.dot.sim{outline:2px solid #b26b00}
"""


def load(keep: int = 16, d: str | None = None) -> tuple[dict | None, list[dict]]:
    """Latest smoke result and a one-line summary of the last `keep` runs, oldest first."""
    d = d or SMOKE_DIR
    try:
        latest = json.load(open(os.path.join(d, "latest.json")))
    except (OSError, ValueError):
        return None, []
    hist = []
    try:
        names = sorted(f for f in os.listdir(os.path.join(d, "runs")) if f.endswith(".json"))[-keep:]
    except OSError:
        names = []
    for f in names:
        try:
            r = json.load(open(os.path.join(d, "runs", f)))
            hist.append({"at": r["startedAt"], "ok": r["ok"], "simulated": r.get("simulated", False),
                         "pass": r["summary"]["pass"], "total": r["summary"]["total"]})
        except (OSError, ValueError, KeyError):
            pass
    return latest, hist


def _hm(ts: str) -> str:
    return ts[:16].replace("T", " ") + " UTC"


def cell(latest: dict | None, component: str) -> str:
    """Per-check pass/FAIL lines with reason and timing for one component ('' when it has no smoke check)."""
    if not latest:
        return ""
    component = ROW_ID.get(component, component)
    checks = [c for c in latest.get("checks", []) if c.get("component") == component]
    if not checks:
        return ""
    lines = [f'<span class="sm {"pass" if c["ok"] else "fail"}">{"pass" if c["ok"] else "FAIL"}</span> '
             f'{html.escape(c["title"])}: {html.escape(c["reason"])} <span class="ms">{c["ms"]} ms</span>'
             for c in checks]
    sim = " · <b>test run with a bogus target</b>" if latest.get("simulated") else ""
    return f'<div class="smoke"><div class="smh">Smoke {_hm(latest["startedAt"])}{sim}</div>' + "<br>".join(lines) + "</div>"


def banner(latest: dict | None, hist: list[dict]) -> str:
    """One line above the table: last run time, pass count, failing checks, recent runs as dots."""
    if not latest:
        return '<p class="sub">Smoke battery (<code>npm run smoke:prod</code>): no result yet.</p>'
    s = latest["summary"]
    fails = [c for c in latest.get("checks", []) if not c["ok"]]
    why = "; ".join(f'{html.escape(c["title"])}: {html.escape(c["reason"])}' for c in fails[:3])
    dots = "".join(
        f'<span class="dot {"pass" if h["ok"] else "fail"}{" sim" if h["simulated"] else ""}" '
        f'title="{html.escape(_hm(h["at"]))}: {h["pass"]}/{h["total"]} pass{" (test run)" if h["simulated"] else ""}"></span>'
        for h in hist)
    sim = " <b>(test run: one check pointed at a bogus address)</b>" if latest.get("simulated") else ""
    return (f'<p class="sub">Smoke battery (<code>npm run smoke:prod</code>, read-only, every 15 min): last run '
            f'<b>{_hm(latest["startedAt"])}</b> <span class="sm {"pass" if latest["ok"] else "fail"}">'
            f'{s["pass"]}/{s["total"]} pass</span>{sim}{" · " + why if why else ""} · last {len(hist)} runs {dots}'
            f' · <a href="smoke.json">smoke.json</a></p>')
