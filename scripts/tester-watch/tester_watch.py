#!/usr/bin/env python3
"""tester-watch: one read-only view of every EPIC-7 tester (EPIC-7 T6).

Runs on VPS1 as root (it reads the two prod Docker volumes and the live zenod-mt env).
Per tester it shows:
  signup     Google/GitHub identity, account and checkout dates, Stripe subscription status,
             discount (coupon duration, promotion code, end), next invoice amount, card on file
  whatsapp   Phylax binding state and whether a phone is verified on the Zenod number
  saves      last WhatsApp "Saved" reply and count in the last 7 days (Phylax capture jobs), last
             capture on any channel and count (the T2.5 per-tenant capture index, tasks.sqlite)
  usage      AI USD this UTC month (same sum as runtime.ts monthToDateSpendUsd) against
             ZENOD_TENANT_MONTHLY_ALLOWANCE_USD ("no cap set" while unset), Phylax units used in the
             binding's period against ZENOD_PHYLAX_ALLOWANCE_UNITS
  errors     failed captures, AI/Phylax cap hits, past_due, failed billing notices (zenod-mt log)

Who is a tester: the private label->code ledger T4 keeps on VPS1 (scripts/stripe-testers.mjs,
default /root/.local/state/zenod-testers/live-codes.tsv; --testers or TESTER_WATCH_TESTERS
override). Each line is `label<TAB or comma>token[,token...]`; a token is a promotion code (or its
promo_ id), account id, tenant id, user id or email; a `label ...` header line is skipped. JSON is accepted too ({"label": "CODE"} or [{"label":..,"code":..}]). With no
file every account with a tenant is shown (--all forces that).

  tester-watch                 table
  tester-watch --json          JSON (one object per tester)
  tester-watch --check         daily T10 hook: prints `ALERT ...` lines; exit 1 on any alert,
                               2 when a data source cannot be read, 0 when quiet
  tester-watch --redact        mask emails, Google ids and promotion codes (for evidence pages)

Read only: SQLite files are opened `mode=ro`, Stripe gets GETs plus `invoices/create_preview`
(a preview; it creates nothing). The Stripe key is read from the running zenod-mt container and
never printed. Phone numbers are never read out, only whether one is verified.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULTS = {
    "TESTER_WATCH_ZENOD_SERVICE": "zenod-mt-fxpzoo",
    "TESTER_WATCH_ZENOD_VOLUME": "zenod-mt-data",
    "TESTER_WATCH_PHYLAX_VOLUME": "phylax-data",
}
# T4's private ledger (scripts/stripe-testers.mjs: $ZENOD_TESTERS_LEDGER_DIR/live-codes.tsv,
# default ~/.local/state/zenod-testers of the user who issues codes on VPS1: root, per docs/runbooks/epic7-tester-codes.md).
LEDGER_DIR = os.environ.get("ZENOD_TESTERS_LEDGER_DIR", "/root/.local/state/zenod-testers")
DEFAULT_TESTERS = os.path.join(LEDGER_DIR, "live-codes.tsv")
DAY_MS = 86_400_000
SAVE_TOOLS = ("store_memory", "ingest_memory")
CAPTURE_KINDS = ("store", "media_ingest")
CAP_TEXT = re.compile(r"allowance|ai_allowance_exhausted|credit has run out", re.I)
URL = re.compile(r"https?://\S+")
BAD_STRIPE = {"past_due", "unpaid", "incomplete", "incomplete_expired", "canceled", "paused"}


def cfg(key: str) -> str:
    return os.environ.get(key, DEFAULTS[key])


# ---------------------------------------------------------------- pure helpers (tested)

def iso(ms: int | float | None) -> str | None:
    if not ms:
        return None
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def month_start_ms(now_ms: int) -> int:
    t = dt.datetime.fromtimestamp(now_ms / 1000, dt.timezone.utc)
    return int(dt.datetime(t.year, t.month, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)


def parse_testers(text: str) -> list[dict]:
    """label -> tokens. Accepts JSON (dict or list of objects) or tab/comma separated lines."""
    text = text.strip()
    if not text:
        return []
    if text[0] in "[{":
        data = json.loads(text)
        if isinstance(data, dict):
            data = [{"label": k, "code": v} for k, v in data.items()]
        out = []
        for item in data:
            toks = [str(item[k]) for k in ("code", "promotion_code", "email", "account_id", "tenant_id", "user_id")
                    if item.get(k)]
            out.append({"label": str(item.get("label") or toks[0]), "tokens": toks})
        return out
    out = []
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        parts = [p.strip() for p in re.split(r"[\t,;]", line) if p.strip()]
        if len(parts) == 1:
            parts = line.split()
        if parts[0].lower() == "label" and not out:
            continue  # T4 ledger header
        out.append({"label": parts[0], "tokens": parts[1:] or parts[:1]})
    return out


def match_tester(tokens: list[str], row: dict) -> bool:
    keys = {str(v).lower() for v in (row.get("account_id"), row.get("tenant_id"), row.get("user_id"),
                                     row.get("email"), (row.get("stripe") or {}).get("promotion_code"),
                                     (row.get("stripe") or {}).get("promotion_code_id")) if v}
    return any(t.lower() in keys for t in tokens)


def error_head(e: str | None) -> str:
    """First line of an error, URLs removed, 60 chars: never user content or ids."""
    first = (e or "").strip().splitlines()[0] if (e or "").strip() else ""
    return URL.sub("<url>", first)[:60]


def mask_email(e: str | None) -> str | None:
    if not e or "@" not in e:
        return e
    user, dom = e.split("@", 1)
    return f"{user[:1]}***@{dom[:1]}***"


def mask_id(s: str | None, keep: int = 4, tail: int = 0) -> str | None:
    if not s:
        return s
    if len(s) <= keep + tail + 2:
        return s[:keep] + "…"
    return s[:keep] + "…" + (s[-tail:] if tail else "")


def pct(used: float | None, cap: float | None) -> float | None:
    if used is None or not cap:
        return None
    return round(100.0 * used / cap, 1)


def alerts_for(row: dict, now_ms: int, renewal_days: float, cap_pct: float) -> list[str]:
    """The T10 daily check. Each string is one alert for this tester."""
    out = []
    st = row.get("stripe") or {}
    status = st.get("status") or row.get("local_status")
    # EPIC-26 S5: a free month the month-end job ended on purpose is not an alert: round 3 ends every
    # month the team did not extend ("ended_free_time"); "ended_inactive" is the round 1-2 mark.
    planned_end = st.get("month_end") in ("ended_inactive", "ended_free_time") and status == "canceled"
    if planned_end:
        pass
    elif status in BAD_STRIPE or row.get("local_status") == "past_due":
        out.append(f"subscription {status}")
    if st.get("error"):
        out.append(f"stripe read failed: {st['error']}")
    renew = st.get("renews_at_ms")
    if renew and status not in ("canceled",) and not st.get("cancel_at_period_end"):
        days = (renew - now_ms) / DAY_MS
        due = st.get("next_invoice_cents")
        if 0 <= days <= renewal_days and (due is None or due > 0):
            amount = "unknown" if due is None else f"{due / 100:.2f} {st.get('currency', '').upper()}"
            out.append(f"renews in {days:.1f} d with next invoice {amount}: apply the month extension")
    u = row.get("usage") or {}
    if u.get("ai_pct") is not None and u["ai_pct"] >= cap_pct:
        out.append(f"AI usage {u['ai_pct']}% of cap")
    if u.get("phylax_pct") is not None and u["phylax_pct"] >= cap_pct:
        out.append(f"Phylax units {u['phylax_pct']}% of allowance")
    e = row.get("errors") or {}
    if e.get("failed_captures_window"):
        out.append(f"{e['failed_captures_window']} failed capture(s) in the last {e['window_hours']} h")
    if e.get("cap_hits_window"):
        out.append(f"{e['cap_hits_window']} cap hit(s) in the last {e['window_hours']} h")
    if e.get("notice_failures_window"):
        out.append(f"{e['notice_failures_window']} billing notice failure(s) in the last {e['window_hours']} h")
    if row.get("account_id") and row.get("local_status") in ("canceled", "suspended") and not planned_end:
        out.append(f"account {row['local_status']}")
    return out


# ---------------------------------------------------------------- sources

def ro(db: Path) -> sqlite3.Connection | None:
    if not db.exists():
        return None
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def q1(c: sqlite3.Connection | None, sql: str, *args):
    if c is None:
        return None
    try:
        return c.execute(sql, args).fetchone()
    except sqlite3.Error:
        return None


def sh(args: list[str]) -> str:
    r = subprocess.run(args, text=True, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"{args[0]} {' '.join(args[1:3])} exit {r.returncode}")
    return r.stdout


def volume_path(name: str) -> Path:
    return Path(sh(["docker", "volume", "inspect", "--format", "{{.Mountpoint}}", name]).strip())


def zenod_container() -> str:
    svc = cfg("TESTER_WATCH_ZENOD_SERVICE")
    names = sh(["docker", "ps", "--filter", f"label=com.docker.swarm.service.name={svc}",
                "--format", "{{.Names}}"]).split()
    if len(names) != 1:
        raise RuntimeError(f"service {svc}: expected 1 running container, found {len(names)}")
    return names[0]


def container_env(container: str) -> dict[str, str]:
    env = json.loads(sh(["docker", "inspect", "--format", "{{json .Config.Env}}", container]))
    return dict(line.split("=", 1) for line in env if "=" in line)


class Stripe:
    def __init__(self, key: str):
        if not key.startswith(("sk_live_", "rk_live_", "sk_test_", "rk_test_")):
            raise RuntimeError("zenod-mt has no Stripe key")
        self._auth = {"Authorization": f"Bearer {key}", "User-Agent": "zenod-tester-watch/1 (VPS1; EPIC-7 T6)"}

    def _call(self, path: str, form: dict | None = None) -> dict:
        data = urllib.parse.urlencode(form).encode() if form is not None else None
        req = urllib.request.Request(f"https://api.stripe.com/v1/{path}", data=data, headers=self._auth)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"HTTP {e.code} on {path.split('?')[0].split('/')[0]}") from None

    def subscription(self, sid: str) -> dict:
        return self._call(f"subscriptions/{sid}?expand[]=discounts&expand[]=discounts.promotion_code"
                          "&expand[]=discounts.source.coupon&expand[]=customer")

    def has_payment_method(self, customer_id: str) -> bool:
        return bool(self._call(f"payment_methods?customer={customer_id}&limit=1").get("data"))

    def next_invoice(self, sid: str) -> dict:
        # create_preview is a POST but creates nothing (Stripe "preview an invoice").
        return self._call("invoices/create_preview", {"subscription": sid})

    def promotion_code(self, code: str) -> dict | None:
        data = self._call("promotion_codes?" + urllib.parse.urlencode({"code": code, "limit": 1})).get("data")
        return data[0] if data else None


def stripe_view(stripe, sid: str) -> dict:
    s = stripe.subscription(sid)
    items = (s.get("items") or {}).get("data") or [{}]
    renew_s = s.get("current_period_end") or items[0].get("current_period_end")
    cust = s.get("customer") if isinstance(s.get("customer"), dict) else {}
    discounts = []
    for d in s.get("discounts") or []:
        if not isinstance(d, dict):
            continue
        src = d.get("source") or {}
        coupon = d.get("coupon") or (src.get("coupon") if isinstance(src, dict) else None) or {}
        pc = d.get("promotion_code") if isinstance(d.get("promotion_code"), dict) else {}
        discounts.append({
            "coupon": coupon.get("name") or coupon.get("id") if isinstance(coupon, dict) else coupon,
            "percent_off": coupon.get("percent_off") if isinstance(coupon, dict) else None,
            "duration": coupon.get("duration") if isinstance(coupon, dict) else None,
            "duration_in_months": coupon.get("duration_in_months") if isinstance(coupon, dict) else None,
            "promotion_code": pc.get("code"),
            "promotion_code_id": pc.get("id"),
            "start": iso((d.get("start") or 0) * 1000),
            "end": iso((d.get("end") or 0) * 1000),
        })
    card = bool(s.get("default_payment_method") or s.get("default_source")
                or (cust.get("invoice_settings") or {}).get("default_payment_method") or cust.get("default_source"))
    if not card and cust.get("id"):
        card = stripe.has_payment_method(cust["id"])
    view = {
        "status": s.get("status"),
        "cancel_at_period_end": bool(s.get("cancel_at_period_end")),
        # EPIC-26 S5: "ended_inactive" when the month-end job ended an inactive tester's free month on purpose
        "month_end": (s.get("metadata") or {}).get("zenod_tester_month_end"),
        "renews_at_ms": renew_s * 1000 if renew_s else None,
        "renews_at": iso(renew_s * 1000) if renew_s else None,
        "card_on_file": card,
        "discounts": discounts,
        "promotion_code": next((d["promotion_code"] for d in discounts if d["promotion_code"]), None),
        "promotion_code_id": next((d["promotion_code_id"] for d in discounts if d["promotion_code_id"]), None),
        "discount_end": max((d["end"] for d in discounts if d["end"]), default=None)
        if discounts and all(d["end"] for d in discounts) else ("never (forever)" if any(
            d["duration"] == "forever" for d in discounts) else None),
        "currency": s.get("currency"),
        "next_invoice_cents": None,
    }
    if s.get("status") not in ("canceled", "incomplete_expired"):
        try:
            view["next_invoice_cents"] = stripe.next_invoice(sid).get("amount_due")
        except RuntimeError as e:
            view["preview_error"] = str(e)
    return view


def phylax_view(pdata: Path, ptenant: str | None, period_id: str | None, allowance_units: int | None,
                now_ms: int, window_ms: int) -> dict:
    out = {"phone": "none", "last_saved_reply": None, "saved_replies_7d": 0, "failed_7d": 0,
           "failed_window": 0, "cap_hits_window": 0, "used_units": None, "allocated_units": None,
           "units_pct": None}
    if not ptenant:
        return out
    try:
        settings = json.loads((pdata / "phylax-tenant-settings.json").read_text()).get(ptenant) or {}
    except (OSError, ValueError):
        settings = {}
    if settings.get("phoneNumber"):
        out["phone"] = "verified" if settings.get("verified") else "pending"
    jobs = ro(pdata / "phylax-capture-jobs.sqlite")
    tools = ",".join("?" * len(SAVE_TOOLS))
    r = q1(jobs, f"SELECT MAX(COALESCE(delivered_at, updated_at)) AS t, "
                 f"SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS n FROM phylax_capture_jobs "
                 f"WHERE tenant_id=? AND state='done' AND tool IN ({tools}) "
                 f"AND (receipt_text LIKE 'Saved%' OR receipt_text LIKE 'Captured%')",
           now_ms - 7 * DAY_MS, ptenant, *SAVE_TOOLS)
    if r:
        out["last_saved_reply"], out["saved_replies_7d"] = iso(r["t"]), r["n"] or 0
    r = q1(jobs, f"SELECT SUM(CASE WHEN updated_at >= ? THEN 1 ELSE 0 END) AS w, COUNT(*) AS n "
                 f"FROM phylax_capture_jobs WHERE tenant_id=? AND state='error' AND tool IN ({tools}) "
                 f"AND updated_at >= ?", now_ms - window_ms, ptenant, *SAVE_TOOLS, now_ms - 7 * DAY_MS)
    if r:
        out["failed_window"], out["failed_7d"] = r["w"] or 0, r["n"] or 0
    if jobs is not None:
        try:
            rows = jobs.execute("SELECT receipt_text FROM phylax_capture_jobs WHERE tenant_id=? AND updated_at >= ?",
                                (ptenant, now_ms - window_ms)).fetchall()
            out["cap_hits_window"] = sum(1 for x in rows if x[0] and CAP_TEXT.search(x[0]))
        except sqlite3.Error:
            pass
    allow = ro(pdata / "phylax-allowance.sqlite")
    if period_id:
        r = q1(allow, "SELECT used_units, allocated_units FROM phylax_allowance_period_totals "
                      "WHERE tenant_id=? AND period_id=?", ptenant, period_id)
        if r:
            out["used_units"], out["allocated_units"] = r["used_units"], r["allocated_units"]
    r = q1(allow, "SELECT COUNT(*) AS n FROM phylax_paid_work WHERE tenant_id=? AND pause_reason IS NOT NULL "
                  "AND updated_at >= ?", ptenant, now_ms - window_ms)
    if r:
        out["cap_hits_window"] += r["n"] or 0
    out["units_pct"] = pct(out["used_units"], allowance_units)
    return out


def tenant_view(zdata: Path, tenant: str | None, now_ms: int, window_ms: int) -> dict:
    out = {"ai_usd_mtd": None, "last_capture": None, "captures_7d": 0, "failed_captures_7d": 0,
           "failed_captures_window": 0, "cap_hits_window": 0, "error_samples": []}
    if not tenant:
        return out
    usage = ro(zdata / tenant / "usage.sqlite")
    r = q1(usage, "SELECT COALESCE(SUM(COALESCE(provider_cost_usd, cost_usd)), 0) AS s FROM llm_usage "
                  "WHERE ts >= ? AND status='succeeded'", month_start_ms(now_ms))
    out["ai_usd_mtd"] = round(r["s"], 4) if r else (0.0 if usage is None else None)
    tasks = ro(zdata / tenant / "tasks.sqlite")
    kinds = ",".join("?" * len(CAPTURE_KINDS))
    not_selftest = "COALESCE(json_extract(input_json, '$.source'), '') <> 'selftest'"
    r = q1(tasks, f"SELECT MAX(CASE WHEN status='done' THEN created_at END) AS t, "
                  f"SUM(CASE WHEN status='done' AND created_at >= ? THEN 1 ELSE 0 END) AS n, "
                  f"SUM(CASE WHEN status='error' AND updated_at >= ? THEN 1 ELSE 0 END) AS f7, "
                  f"SUM(CASE WHEN status='error' AND updated_at >= ? THEN 1 ELSE 0 END) AS fw "
                  f"FROM task_jobs WHERE kind IN ({kinds}) AND {not_selftest}",
           now_ms - 7 * DAY_MS, now_ms - 7 * DAY_MS, now_ms - window_ms, *CAPTURE_KINDS)
    if r:
        out["last_capture"], out["captures_7d"] = iso(r["t"]), r["n"] or 0
        out["failed_captures_7d"], out["failed_captures_window"] = r["f7"] or 0, r["fw"] or 0
    r = q1(tasks, "SELECT COUNT(*) AS n FROM task_jobs WHERE updated_at >= ? AND "
                  "(result_json LIKE '%ai_allowance_exhausted%' OR result_json LIKE '%AI allowance%')",
           now_ms - window_ms)
    if r:
        out["cap_hits_window"] = r["n"] or 0
    if tasks is not None:
        try:
            rows = tasks.execute("SELECT kind, error FROM task_jobs WHERE status='error' AND updated_at >= ? "
                                 "ORDER BY updated_at DESC LIMIT 3", (now_ms - 7 * DAY_MS,)).fetchall()
            # First words only: no URLs, ids or user content.
            out["error_samples"] = [f"{k}: {error_head(e)}" for k, e in rows]
        except sqlite3.Error:
            pass
    return out


def log_events(container: str, since_hours: float) -> list[str]:
    r = subprocess.run(["docker", "logs", "--since", f"{int(since_hours * 3600)}s", container],
                       text=True, capture_output=True)
    return [line for line in (r.stdout + r.stderr).splitlines()
            if "notice failed for account" in line or "[llm.allowance.exceeded]" in line]


# ---------------------------------------------------------------- collect

def collect(zdata: Path, pdata: Path, env: dict[str, str], stripe, testers: list[dict] | None,
            now_ms: int, window_hours: float, logs: list[str]) -> tuple[list[dict], list[str]]:
    window_ms = int(window_hours * 3_600_000)
    problems: list[str] = []
    accounts = json.loads((zdata / "customer-accounts.json").read_text())
    ident = json.loads((zdata / "customer-identities.json").read_text())
    ids_by_user: dict[str, list[dict]] = {}
    for i in ident.get("identities", []):
        ids_by_user.setdefault(i["user_id"], []).append(i)
    # One row per account: the session with a tenant (newest) wins over checkout_pending leftovers.
    by_account: dict[str, dict] = {}
    for a in accounts.values():
        cur = by_account.get(a.get("account_id"))
        if cur is None or (a.get("tenant_id") and not cur.get("tenant_id")) or (
                bool(a.get("tenant_id")) == bool(cur.get("tenant_id")) and (a.get("claimed_at") or "") > (cur.get("claimed_at") or "")):
            by_account[a.get("account_id")] = a
    adapter = ro(zdata / "zenod-phylax-adapter.sqlite")
    bindings = {}
    if adapter is not None:
        for b in adapter.execute("SELECT account_id, phylax_tenant_id, state, period_id FROM zenod_phylax_bindings"):
            bindings[b["account_id"]] = dict(b)
    comped = {x.strip() for x in env.get("ZENOD_PHYLAX_COMPED_ACCOUNT_IDS", "").split(",") if x.strip()}
    ai_cap = env.get("ZENOD_TENANT_MONTHLY_ALLOWANCE_USD") or None
    ai_cap_f = float(ai_cap) if ai_cap else None
    units_cap = int(env["ZENOD_PHYLAX_ALLOWANCE_UNITS"]) if env.get("ZENOD_PHYLAX_ALLOWANCE_UNITS") else None

    rows = []
    for acc_id, a in by_account.items():
        if not a.get("tenant_id"):
            continue
        idents = ids_by_user.get(a.get("user_id"), [])
        google = next((i for i in idents if i["provider"] == "google"), None)
        first = google or (idents[0] if idents else {})
        row = {
            "account_id": acc_id, "tenant_id": a.get("tenant_id"), "user_id": a.get("user_id"),
            "provider": first.get("provider") or ("github" if a.get("github_id") else None),
            "google_id": google.get("provider_subject") if google else None,
            "email": first.get("email") or a.get("stripe_email") or a.get("github_email"),
            "signed_up": first.get("created_at"), "checkout_at": a.get("checkout_completed_at"),
            "local_status": a.get("subscription_status"), "comped": acc_id in comped,
            "stripe": None,
        }
        if a.get("stripe_subscription_id") and stripe is not None:
            try:
                row["stripe"] = stripe_view(stripe, a["stripe_subscription_id"])
            except Exception as e:  # noqa: BLE001 - one bad read must not hide the other rows
                row["stripe"] = {"error": str(e)[:80]}
                problems.append(f"stripe read failed for {acc_id}")
        b = bindings.get(acc_id) or {}
        ph = phylax_view(pdata, b.get("phylax_tenant_id"), b.get("period_id"), units_cap, now_ms, window_ms)
        tv = tenant_view(zdata, a.get("tenant_id"), now_ms, window_ms)
        row["whatsapp"] = {"binding": b.get("state") or "none", "phone": ph["phone"]}
        row["saves"] = {"last_saved_reply": ph["last_saved_reply"], "saved_replies_7d": ph["saved_replies_7d"],
                        "last_capture_any": tv["last_capture"], "captures_7d": tv["captures_7d"]}
        row["usage"] = {"ai_usd_mtd": tv["ai_usd_mtd"], "ai_cap_usd": ai_cap_f,
                        "ai_pct": pct(tv["ai_usd_mtd"], ai_cap_f),
                        "phylax_units_used": ph["used_units"], "phylax_units_allocated": ph["allocated_units"],
                        "phylax_units_cap": units_cap, "phylax_pct": ph["units_pct"]}
        tid = a.get("tenant_id")
        row["errors"] = {
            "window_hours": window_hours,
            "failed_captures_7d": tv["failed_captures_7d"] + ph["failed_7d"],
            "failed_captures_window": tv["failed_captures_window"] + ph["failed_window"],
            "cap_hits_window": tv["cap_hits_window"] + ph["cap_hits_window"]
            + sum(1 for x in logs if "[llm.allowance.exceeded]" in x and f"tenant={tid} " in x),
            "notice_failures_window": sum(1 for x in logs if f"notice failed for account {acc_id}" in x),
            "samples": tv["error_samples"],
        }
        rows.append(row)

    if testers is not None:
        picked = []
        for t in testers:
            hit = next((r for r in rows if match_tester(t["tokens"], r)), None)
            if hit:
                picked.append({**hit, "label": t["label"], "is_label_from_file": True})
            else:
                info = {"label": t["label"], "is_label_from_file": True, "account_id": None, "signup": "not signed up"}
                code = next((x for x in t["tokens"] if "@" not in x and not x.startswith(("user-", "usr_"))), None)
                if code and stripe is not None:
                    try:
                        pc = stripe.promotion_code(code)
                        info["code"] = {"code": pc.get("code"), "active": pc.get("active"),
                                        "times_redeemed": pc.get("times_redeemed"),
                                        "expires_at": iso((pc.get("expires_at") or 0) * 1000)} if pc \
                            else {"error": "code not found in Stripe"}
                    except RuntimeError as e:
                        info["code"] = {"error": str(e)}
                picked.append(info)
        rows = picked
    else:
        # Without a testers list, a canceled legacy account is history, not a tester to watch.
        rows = [r for r in rows if r["local_status"] not in ("canceled", "checkout_pending")]
        for r in rows:
            r["label"] = "comped" if r["comped"] else r["tenant_id"]
    return rows, problems


# ---------------------------------------------------------------- output

def redact(rows: list[dict]) -> list[dict]:
    out = json.loads(json.dumps(rows))
    for r in out:
        r["email"] = mask_email(r.get("email"))
        r["google_id"] = mask_id(r.get("google_id"))
        for k in ("account_id", "tenant_id", "user_id"):
            r[k] = mask_id(r.get(k), 9, 4)
        if r.get("label") and r["label"] != "comped":
            # Labels from the private testers file may be names: keep 2 chars only.
            r["label"] = mask_id(r["label"], 2) if r.get("is_label_from_file") or not r.get("account_id") \
                else mask_id(r["label"], 9, 4)
        st = r.get("stripe") or {}
        for d in [st, *(st.get("discounts") or [])]:
            for k in ("coupon", "promotion_code", "promotion_code_id"):
                if d.get(k):
                    d[k] = mask_id(d[k], 2)
        if isinstance(r.get("code"), dict) and r["code"].get("code"):
            r["code"]["code"] = mask_id(r["code"]["code"], 2)
    return out


def short(t: str | None) -> str:
    return t[:16].replace("T", " ") if t else "-"


def table(rows: list[dict], now_ms: int) -> str:
    head = ["tester", "identity", "checkout", "stripe", "renews", "next inv", "discount", "card",
            "whatsapp", "last Saved", "7d saves", "AI $ mtd", "units", "errors 7d"]
    lines = [head]
    for r in rows:
        if not r.get("account_id"):
            c = r.get("code") or {}
            state = c.get("error") or (f"code active={c.get('active')} used={c.get('times_redeemed')}"
                                       f" exp={short(c.get('expires_at'))}" if c else "code not checked")
            lines.append([r["label"], "-", "not signed up", state] + ["-"] * 10)
            continue
        st = r.get("stripe") or {}
        u, s, e, w = r["usage"], r["saves"], r["errors"], r["whatsapp"]
        nxt = st.get("next_invoice_cents")
        ai = "-" if u["ai_usd_mtd"] is None else f"{u['ai_usd_mtd']:.2f}"
        ai += f"/{u['ai_cap_usd']:g} ({u['ai_pct']}%)" if u["ai_cap_usd"] else " (no cap set)"
        units = "-" if u["phylax_units_used"] is None else f"{u['phylax_units_used']}"
        units += f" ({u['phylax_pct']}%)" if u["phylax_pct"] is not None else ""
        lines.append([
            r["label"], f"{r.get('provider') or '-'} {r.get('email') or ''}".strip(), short(r.get("checkout_at")),
            st.get("status") or ("comped, no Stripe" if r.get("comped") else (st.get("error") or r.get("local_status"))),
            short(st.get("renews_at")), "-" if nxt is None else f"{nxt / 100:.2f}",
            short(st["discount_end"]) if (st.get("discount_end") or "x")[0].isdigit() else st.get("discount_end") or "-",
            "-" if not st else ("yes" if st.get("card_on_file") else "no"),
            f"{w['phone']}/{w['binding']}", short(s["last_saved_reply"]),
            f"{s['saved_replies_7d']} wa/{s['captures_7d']} all", ai, units,
            f"{e['failed_captures_7d']} fail, {e['cap_hits_window']} cap" + (f"; {e['samples'][0]}" if e["samples"] else ""),
        ])
    widths = [max(len(str(x[i])) for x in lines) for i in range(len(head))]
    return "\n".join("  ".join(str(x[i]).ljust(widths[i]) for i in range(len(head))).rstrip() for x in lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--testers", help="label->code file (default $TESTER_WATCH_TESTERS or %s)" % DEFAULT_TESTERS)
    ap.add_argument("--all", action="store_true", help="every account with a tenant, ignore the testers file")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--check", action="store_true", help="daily hook: ALERT lines, exit 1 on alerts, 2 on read errors")
    ap.add_argument("--redact", action="store_true", help="mask emails, ids and codes")
    ap.add_argument("--window-hours", type=float, default=24.0, help="failure/cap-hit window for --check (default 24)")
    ap.add_argument("--renewal-days", type=float, default=5.0)
    ap.add_argument("--cap-pct", type=float, default=80.0)
    ap.add_argument("--no-stripe", action="store_true", help="skip Stripe (offline view)")
    a = ap.parse_args(argv)

    now_ms = int(time.time() * 1000)
    try:
        container = zenod_container()
        env = container_env(container)
        zdata, pdata = volume_path(cfg("TESTER_WATCH_ZENOD_VOLUME")), volume_path(cfg("TESTER_WATCH_PHYLAX_VOLUME"))
        stripe = None if a.no_stripe else Stripe(env.get("STRIPE_SECRET_KEY", ""))
        logs = log_events(container, a.window_hours)
    except Exception as e:  # noqa: BLE001
        print(f"ALERT tester-watch cannot read prod: {e}")
        return 2
    testers = None
    path = a.testers or os.environ.get("TESTER_WATCH_TESTERS") or DEFAULT_TESTERS
    note = None
    if not a.all:
        if Path(path).exists():
            testers = parse_testers(Path(path).read_text())
        elif a.testers:
            print(f"ALERT testers file not found: {a.testers}")
            return 2
        else:
            note = f"no testers file at {path}: showing every account with a tenant"
    try:
        rows, problems = collect(zdata, pdata, env, stripe, testers, now_ms, a.window_hours, logs)
    except Exception as e:  # noqa: BLE001
        print(f"ALERT tester-watch failed: {e}")
        return 2
    shown = redact(rows) if a.redact else rows
    alerts = [(s["label"], x) for r, s in zip(rows, shown) if r.get("account_id")
              for x in alerts_for(r, now_ms, a.renewal_days, a.cap_pct)]
    alerts += [(s["label"], f"tester code: {r['code']['error']}") for r, s in zip(rows, shown)
               if not r.get("account_id") and (r.get("code") or {}).get("error")]
    if a.json:
        print(json.dumps({"generated_at": iso(now_ms), "note": note, "testers": shown,
                          "alerts": [f"{lab}: {x}" for lab, x in alerts], "problems": problems}, indent=2))
    else:
        if note:
            print(f"# {note}")
        print(f"# tester-watch {iso(now_ms)} · AI cap: "
              f"{env.get('ZENOD_TENANT_MONTHLY_ALLOWANCE_USD') or 'no cap set'} USD/month · Phylax allowance: "
              f"{env.get('ZENOD_PHYLAX_ALLOWANCE_UNITS') or '-'} units · errors window {a.window_hours:g} h")
        if not a.check or rows:
            print(table(shown, now_ms))
    if a.check:
        for lab, x in alerts:
            print(f"ALERT {lab}: {x}")
        for p in problems:
            print(f"ALERT {p}")
        if not alerts and not problems:
            print(f"OK {len(rows)} tester(s), no alerts")
        return 2 if problems else (1 if alerts else 0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
