#!/usr/bin/env python3
"""zenod-readiness-keeper: keep Zenod production checkout open (EPIC-7 T2.3).

Paid checkout is gated by /api/public/production-readiness
(packages/server/src/productionReadiness.ts). Three blocking checks are dated
proofs that age out: backup_restore (31 d), stripe_profile (90 d) and, while public
Google signup is on, google_drive_vault_oauth (90 d). This host tool (VPS1, root):

  run             daily (timer 04:30 Europe/Madrid): runs the two-volume backup-restore
                  drill when the proof is >= DRILL_MIN_AGE_DAYS old, re-verifies the live
                  Stripe profile when it is >= STRIPE_MIN_AGE_DAYS old, and only on success
                  writes the new *_VERIFIED_AT values to Dokploy zenod-mt in one redeploy.
  drill           the drill alone (docs/PRODUCTION-READINESS.md "Two-volume cold backup and
                  restore drill"): scripts/zenod-volume-backup.sh on both volumes, isolated
                  restore + verifier, off-host copy to Hetzner object storage, rclone check.
  stripe-profile  read-only live Stripe check (business name, support email, website, portal
                  Terms/Privacy links); --apply records ZENOD_STRIPE_PROFILE_VERIFIED_AT.
  watch           hourly: alert when checkout readiness is false or a dated proof is within
                  ALERT_DAYS of expiry, through the HQ alert queue (agent_team relay watchdog,
                  ~/agent_team_m0/alerts.pending, delivered to the T3 "HQ — vps1 alerts" thread).
  status          print each dated proof with its expiry (JSON).
  test-alert      queue one [TEST] message to prove delivery.

Never sets a timestamp prospectively: values are the actual completion time of a proof that
just passed. Secrets (Dokploy key, Stripe key, S3 key) are read at run time and never printed.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Cloudflare in front of zenod.dev answers 403 to the default Python-urllib agent.
UA = {"User-Agent": "zenod-readiness-keeper/1 (VPS1; EPIC-7 T2.3)"}

# Mirrors packages/server/src/productionReadiness.ts (keeper.test.py asserts the windows match).
# (check id, env key, window days, who renews)
DATED_CHECKS = [
    ("backup_restore", "ZENOD_BACKUP_RESTORE_VERIFIED_AT", 31, "automatic: zenod-readiness-keeper drill"),
    ("stripe_profile", "ZENOD_STRIPE_PROFILE_VERIFIED_AT", 90, "automatic: zenod-readiness-keeper Stripe check"),
    ("google_drive_vault_oauth", "ZENOD_GOOGLE_DRIVE_VAULT_OAUTH_VERIFIED_AT", 90,
     "Jordi: re-verify the Drive OAuth client/branding in Google Cloud console, then an agent sets the env"),
]
GOOGLE_ONLY = {"google_drive_vault_oauth"}
ADVISORY = {"stripe_webhook", "billing_portal", "live_billing_journey", "google_drive_vault_acceptance"}

DEFAULTS = {
    "KEEPER_APP_ID": "2dkayH_eAur427leH64MT",            # Dokploy zenod-mt
    "KEEPER_ZENOD_SERVICE": "zenod-mt-fxpzoo",
    "KEEPER_ZENOD_VOLUME": "zenod-mt-data",
    "KEEPER_PHYLAX_SERVICE": "app-index-back-end-panel-6zm3qg",
    "KEEPER_PHYLAX_VOLUME": "phylax-data",
    "KEEPER_ZENOD_HEALTHZ": "https://cloud.zenod.dev/healthz",
    "KEEPER_ZENOD_HEALTH": "https://cloud.zenod.dev/api/health",
    "KEEPER_PHYLAX_HEALTHZ": "https://phylax.zenod.dev/healthz",
    "KEEPER_PHYLAX_HEALTH": "https://phylax.zenod.dev/api/health",
    "KEEPER_READINESS_URL": "https://cloud.zenod.dev/api/public/production-readiness",
    "KEEPER_BACKUP_ROOT": "/var/backups/zenod",
    "KEEPER_KEEP_LOCAL": "2",                           # keeper-* drill dirs kept per volume
    "KEEPER_MIN_FREE_GB": "12",
    "KEEPER_S3_PREFIX": "s31:vps-archives/archives/vps-a9-1/zenod-backups",
    "KEEPER_S3_ENDPOINT": "https://hel1.your-objectstorage.com",
    "KEEPER_RCLONE_IMAGE": "rclone/rclone:1.68.2",
    "KEEPER_DOKPLOY_ENV": "/home/t3agent/.config/alpha9/dokploy.env",
    "KEEPER_DOKPLOY_KEY_FILE": "/home/t3agent/.config/alpha9/dokploy-api-key",
    "KEEPER_ALERT_DIR": "/home/t3agent/agent_team_m0/alerts.pending",
    "KEEPER_STATE_DIR": "/var/lib/zenod-readiness-keeper",
    "KEEPER_DRILL_MIN_AGE_DAYS": "24",
    "KEEPER_STRIPE_MIN_AGE_DAYS": "60",
    "KEEPER_ALERT_DAYS": "7",
    "KEEPER_REALERT_HOURS": "24",
    "KEEPER_STRIPE_NAME": "Zenod",
    "KEEPER_SITE_HOST": "zenod.dev",
}


def cfg(key: str, env=os.environ) -> str:
    return env.get(key, DEFAULTS[key])


def log(msg: str) -> None:
    print(f"[keeper {utc_iso(now_utc())}] {msg}", flush=True)


# ---------------------------------------------------------------- pure helpers (tested)

def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def utc_iso(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        t = dt.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def parse_env(text: str) -> dict[str, str]:
    out = {}
    for line in text.splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v
    return out


def set_env_lines(text: str, updates: dict[str, str]) -> str:
    """Replace KEY=... lines (append when absent); every other line kept byte-for-byte."""
    lines, seen = text.splitlines(), set()
    for i, line in enumerate(lines):
        if "=" in line and not line.lstrip().startswith("#"):
            k = line.split("=", 1)[0].strip()
            if k in updates:
                lines[i] = f"{k}={updates[k]}"
                seen.add(k)
    lines += [f"{k}={v}" for k, v in updates.items() if k not in seen]
    return "\n".join(lines) + ("\n" if text.endswith("\n") else "")


def proof_status(env: dict[str, str], now: dt.datetime) -> list[dict]:
    """Each dated blocking proof that applies, with its expiry."""
    google = env.get("ZENOD_PUBLIC_GOOGLE_SIGNUP") == "1"
    out = []
    for cid, key, days, renews in DATED_CHECKS:
        if cid in GOOGLE_ONLY and not google:
            continue
        at = parse_iso(env.get(key))
        exp = at + dt.timedelta(days=days) if at else None
        out.append({
            "id": cid, "env": key, "windowDays": days, "renews": renews,
            "verifiedAt": utc_iso(at) if at else None,
            "expiresAt": utc_iso(exp) if exp else None,
            "ageDays": round((now - at).total_seconds() / 86400, 2) if at else None,
            "daysLeft": round((exp - now).total_seconds() / 86400, 2) if exp else None,
        })
    return out


def due(proof: dict | None, min_age_days: float) -> bool:
    return proof is None or proof["ageDays"] is None or proof["ageDays"] >= min_age_days


def watch_issues(readiness: dict | None, readiness_error: str | None, proofs: list[dict] | None,
                 env_error: str | None, alert_days: float) -> list[tuple[str, str, str]]:
    """-> [(key, level ALERT|WARN, text)] for the current state."""
    issues = []
    if readiness_error:
        issues.append(("readiness-unreachable", "WARN",
                       f"zenod readiness endpoint unreachable ({readiness_error}); cannot tell whether checkout is open."))
    elif readiness is not None and readiness.get("ready") is not True:
        failing = [c["id"] for c in readiness.get("checks", []) if not c.get("ok") and c["id"] not in ADVISORY]
        issues.append(("checkout-closed", "ALERT",
                       "zenod checkout CLOSED: production readiness ready=false, failing "
                       f"{', '.join(failing) or 'unknown'}. Testers cannot sign up. Runbook: "
                       "scripts/readiness-keeper/README.md (fallback: ZENOD_LIVE_CHECKOUT_TESTER_GOOGLE_EMAILS)."))
    if env_error:
        issues.append(("dokploy-unreachable", "WARN",
                       f"zenod readiness watch cannot read zenod-mt env from Dokploy ({env_error}); proof expiries unknown."))
    for p in proofs or []:
        if p["daysLeft"] is None:
            continue
        if p["daysLeft"] <= alert_days:
            level = "ALERT" if p["daysLeft"] <= 0 else "WARN"
            when = "EXPIRED" if p["daysLeft"] <= 0 else f"expires in {p['daysLeft']:.1f} days"
            issues.append((f"expiry-{p['id']}", level,
                           f"zenod readiness proof {p['id']} {when} ({p['expiresAt']}); checkout closes when it lapses. "
                           f"Renewal: {p['renews']}."))
    return issues


def plan_alerts(issues, state: dict, now_ts: int, realert_s: int):
    """-> (messages [(kind, key, text)], new_state). Dedupe per key, re-alert after realert_s,
    one RECOVERED when an alerted key clears."""
    msgs, new_state = [], {}
    current = {k for k, _, _ in issues}
    for key, level, text in issues:
        prev = state.get(key)
        if prev is None or prev.get("level") != level or now_ts - int(prev.get("lastAlert", 0)) >= realert_s:
            msgs.append((level, key, text))
            new_state[key] = {"level": level, "lastAlert": now_ts, "first": (prev or {}).get("first", now_ts)}
        else:
            new_state[key] = prev
    for key, prev in state.items():
        if key not in current:
            msgs.append(("RECOVERED", key, f"zenod readiness: {key} cleared (open since "
                         f"{utc_iso(dt.datetime.fromtimestamp(int(prev.get('first', now_ts)), dt.timezone.utc))})."))
    return msgs, new_state


def queue_alert(alert_dir: Path, kind: str, text: str, dry: bool) -> str:
    """Atomic write into the relay-watchdog queue (same file contract as infra-vps disk_guard.py)."""
    if dry:
        log(f"alert=would-queue kind={kind} msg=[[{kind}] {text}]")
        return "dry"
    if not alert_dir.is_dir():
        log(f"alert=skipped kind={kind} reason=no-queue-dir dir={alert_dir} msg=[{text}]")
        return "no-dir"
    name = f"{int(time.time())}-{time.time_ns() % 10**9:09d}-{kind}.msg"
    tmp = alert_dir / f".tmp-{os.getpid()}-{name}"
    tmp.write_text(f"[{kind}] {text}\n")
    st = alert_dir.stat()
    with contextlib.suppress(PermissionError):
        os.chown(tmp, st.st_uid, st.st_gid)
    tmp.chmod(0o644)
    os.replace(tmp, alert_dir / name)
    log(f"alert=queued kind={kind} file={name}")
    return name


# ---------------------------------------------------------------- I/O helpers

def http_json(url: str, headers=None, data: dict | None = None, timeout=30, accept_status=(200,)):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={**UA, **(headers or {}),
                                 **({"Content-Type": "application/json"} if body else {})},
                                 method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
        if status not in accept_status:
            raise RuntimeError(f"HTTP {status} from {urllib.parse.urlsplit(url).netloc}{urllib.parse.urlsplit(url).path}")
    return json.loads(raw) if raw.strip() else {}


def http_ok(url: str, timeout=10) -> bool:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA, method="GET"), timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


class Dokploy:
    def __init__(self, env=os.environ):
        base = parse_env(Path(cfg("KEEPER_DOKPLOY_ENV", env)).read_text()).get("DOKPLOY_API_BASE", "").strip().strip('"')
        if not base:
            raise RuntimeError("DOKPLOY_API_BASE missing")
        self.base = base.rstrip("/")
        self._key = Path(cfg("KEEPER_DOKPLOY_KEY_FILE", env)).read_text().strip()
        self.app_id = cfg("KEEPER_APP_ID", env)

    def app(self) -> dict:
        return http_json(f"{self.base}/application.one?applicationId={self.app_id}", {"x-api-key": self._key})

    def env(self) -> dict[str, str]:
        return parse_env(self.app().get("env") or "")

    def save_env_and_redeploy(self, updates: dict[str, str], title: str) -> None:
        app = self.app()
        before = app.get("env") or ""
        after = set_env_lines(before, updates)
        changed = [k for k in set(parse_env(before)) | set(parse_env(after))
                   if parse_env(before).get(k) != parse_env(after).get(k)]
        if sorted(changed) != sorted(updates):
            raise RuntimeError(f"refusing env write: unexpected key delta {sorted(changed)}")
        http_json(f"{self.base}/application.saveEnvironment", {"x-api-key": self._key}, {
            "applicationId": self.app_id, "env": after,
            "buildArgs": app.get("buildArgs"), "buildSecrets": app.get("buildSecrets"),
            "createEnvFile": bool(app.get("createEnvFile")),
        })
        if parse_env(self.app().get("env") or "") != parse_env(after):
            raise RuntimeError("Dokploy env did not persist")
        log(f"dokploy env saved ({', '.join(f'{k}={v}' for k, v in updates.items())}); lines {len(before.splitlines())}->{len(after.splitlines())}")
        http_json(f"{self.base}/application.redeploy", {"x-api-key": self._key},
                  {"applicationId": self.app_id, "title": title})
        log("dokploy redeploy requested")


def sh(args: list[str], env=None, check=True, capture=True) -> str:
    r = subprocess.run(args, env=env, text=True, capture_output=capture)
    if check and r.returncode != 0:
        tail = ((r.stderr or "") + (r.stdout or "")).strip().splitlines()[-5:]
        raise RuntimeError(f"{os.path.basename(args[0])} {' '.join(args[1:3])} exit {r.returncode}: {' | '.join(tail)}")
    return (r.stdout or "").strip()


def service_container(service: str) -> str:
    names = sh(["docker", "ps", "--filter", f"label=com.docker.swarm.service.name={service}",
                "--format", "{{.Names}}"]).split()
    if len(names) != 1:
        raise RuntimeError(f"service {service}: expected exactly 1 running container, found {len(names)}")
    return names[0]


def container_env(container: str) -> dict[str, str]:
    return parse_env("\n".join(json.loads(sh(["docker", "inspect", "--format", "{{json .Config.Env}}", container]))))


@contextlib.contextmanager
def lock(state_dir: Path):
    state_dir.mkdir(parents=True, exist_ok=True)
    fh = open(state_dir / "keeper.lock", "w")
    try:
        fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError("another keeper run holds the lock")
    try:
        yield
    finally:
        fh.close()


# ---------------------------------------------------------------- drill

RCLONE_WRAP = r'''
export RCLONE_CONFIG_S31_TYPE=s3 RCLONE_CONFIG_S31_PROVIDER=Other RCLONE_CONFIG_S31_ENDPOINT="$KEEPER_S3_ENDPOINT"
export RCLONE_CONFIG_S31_ACCESS_KEY_ID="$HETZNER_ACCESS_KEY" RCLONE_CONFIG_S31_SECRET_ACCESS_KEY="$HETZNER_SECRET_KEY"
src="$1"; shift
exec docker run --rm -e RCLONE_CONFIG_S31_TYPE -e RCLONE_CONFIG_S31_PROVIDER -e RCLONE_CONFIG_S31_ENDPOINT \
  -e RCLONE_CONFIG_S31_ACCESS_KEY_ID -e RCLONE_CONFIG_S31_SECRET_ACCESS_KEY \
  -v "$src:/src:ro" "$KEEPER_RCLONE_IMAGE" "$@"
'''


def rclone(src_dir: Path, *args: str) -> str:
    env = {**os.environ, "KEEPER_S3_ENDPOINT": cfg("KEEPER_S3_ENDPOINT"), "KEEPER_RCLONE_IMAGE": cfg("KEEPER_RCLONE_IMAGE")}
    return sh(["secret", "run", "hetzner-s3", "--", "bash", "-c", RCLONE_WRAP, "rclone-wrap", str(src_dir), *args], env=env)


def backup_volume(service: str, volume: str, archive_dir: Path, health: str, verify_image: str | None) -> dict:
    container = service_container(service)
    env = {**os.environ, "ZENOD_HEALTH_URL": health}
    if verify_image:
        env["ZENOD_VERIFY_IMAGE"] = verify_image
    t0 = time.time()
    out = sh(["bash", str(HERE / "zenod-volume-backup.sh"), container, volume, str(archive_dir)], env=env)
    res = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
    for k in ("backup", "checksum", "restore_verified_at"):
        if k not in res:
            raise RuntimeError(f"backup script output missing {k}")
    verifier = next((l for l in out.splitlines() if l.startswith("{") and '"ok"' in l), None)
    sha = Path(res["checksum"]).read_text().split()[0]
    return {"service": service, "container": container, "volume": volume, "archive": res["backup"],
            "bytes": Path(res["backup"]).stat().st_size, "sha256": sha, "verifier": verifier,
            "restoreVerifiedAt": res["restore_verified_at"], "seconds": round(time.time() - t0),
            "mode": res.get("mode", "cold"), "pausedMs": int(res["paused_ms"]) if res.get("paused_ms", "").isdigit() else None}


def wait_phylax_connected(timeout_s=180) -> str:
    deadline, state = time.time() + timeout_s, "unknown"
    while time.time() < deadline:
        with contextlib.suppress(Exception):
            h = http_json(cfg("KEEPER_PHYLAX_HEALTH"), timeout=10)
            state = h.get("channels", {}).get("whatsapp", {}).get("state", "unknown")
            if state == "connected":
                return state
        time.sleep(5)
    return state


def prune_local(root: Path, keep: int) -> list[str]:
    dirs = sorted(p for p in root.glob("keeper-*") if p.is_dir())
    gone = []
    for p in dirs[:-keep] if keep > 0 else dirs:
        shutil.rmtree(p)
        gone.append(str(p))
    return gone


def drill(dry: bool) -> dict:
    zsvc, psvc = cfg("KEEPER_ZENOD_SERVICE"), cfg("KEEPER_PHYLAX_SERVICE")
    zc, pc = service_container(zsvc), service_container(psvc)
    zimage = sh(["docker", "inspect", "--format", "{{.Config.Image}}", zc])
    root = Path(cfg("KEEPER_BACKUP_ROOT"))
    free_gb = shutil.disk_usage(root if root.exists() else "/").free / 1024**3
    for url in (cfg("KEEPER_ZENOD_HEALTHZ"), cfg("KEEPER_PHYLAX_HEALTHZ")):
        if not http_ok(url):
            raise RuntimeError(f"preflight: {url} not healthy, refusing to pause anything")
    if free_gb < float(cfg("KEEPER_MIN_FREE_GB")):
        raise RuntimeError(f"preflight: only {free_gb:.1f} GB free under {root}")
    stamp = now_utc().strftime("%Y%m%dT%H%M%SZ")
    plan = {"stamp": stamp, "zenodContainer": zc, "phylaxContainer": pc, "verifierImage": zimage,
            "freeGb": round(free_gb, 1)}
    log(f"preflight ok {json.dumps(plan)}")
    if dry:
        return {"dryRun": True, **plan}
    pub = backup_volume(zsvc, cfg("KEEPER_ZENOD_VOLUME"), root / "public" / f"keeper-{stamp}",
                        cfg("KEEPER_ZENOD_HEALTHZ"), None)
    log(f"public volume ok {json.dumps(pub)}")
    chan = backup_volume(psvc, cfg("KEEPER_PHYLAX_VOLUME"), root / "channels" / f"keeper-{stamp}",
                         cfg("KEEPER_PHYLAX_HEALTHZ"), zimage)
    log(f"channels volume ok {json.dumps(chan)}")
    wa = wait_phylax_connected()
    log(f"phylax whatsapp after resume: {wa}")
    prefix = f"{cfg('KEEPER_S3_PREFIX')}/{stamp[:8]}-keeper"
    for label, item in (("public", pub), ("channels", chan)):
        src = Path(item["archive"]).parent
        dest = f"{prefix}/{label}/"
        rclone(src, "copy", "/src", dest, "--s3-no-check-bucket")
        out = rclone(src, "check", "/src", dest, "--download", "--one-way", "--s3-no-check-bucket")
        item["offHost"] = dest
        log(f"off-host {label} -> {dest} verified (rclone check --download) {out[-120:] if out else ''}")
    verified_at = max(pub["restoreVerifiedAt"], chan["restoreVerifiedAt"])
    pruned = prune_local(root / "public", int(cfg("KEEPER_KEEP_LOCAL"))) + \
        prune_local(root / "channels", int(cfg("KEEPER_KEEP_LOCAL")))
    return {**plan, "public": pub, "channels": chan, "whatsappAfter": wa, "offHostPrefix": prefix,
            "offHostVerifiedAt": utc_iso(now_utc()), "verifiedAt": verified_at, "prunedLocal": pruned}


# ---------------------------------------------------------------- stripe profile

def stripe_profile_check(env: dict[str, str]) -> dict:
    sk = env.get("STRIPE_SECRET_KEY", "")
    if not (sk.startswith("sk_live_") or sk.startswith("rk_live_")):
        raise RuntimeError("zenod-mt has no live Stripe key")
    auth = {"Authorization": f"Bearer {sk}"}
    acct = http_json("https://api.stripe.com/v1/account", auth)
    bp = acct.get("business_profile") or {}
    site = cfg("KEEPER_SITE_HOST")
    portal_id = env.get("STRIPE_PORTAL_CONFIGURATION_ID", "")
    portal = http_json(f"https://api.stripe.com/v1/billing_portal/configurations/{portal_id}", auth) if portal_id else {}
    pbp = portal.get("business_profile") or {}
    url = bp.get("url") or ""
    site_url = url if "://" in url else f"https://{url}"
    observed = {
        "businessName": bp.get("name"), "legalBusiness": (acct.get("company") or {}).get("name"),
        "supportEmail": bp.get("support_email"), "website": url,
        "portalActive": portal.get("active"), "terms": pbp.get("terms_of_service_url"),
        "privacy": pbp.get("privacy_policy_url"),
    }

    def on_site(u):
        return bool(u) and urllib.parse.urlsplit(u).scheme == "https" and \
            (urllib.parse.urlsplit(u).hostname or "").endswith(site)

    checks = {
        "businessName": observed["businessName"] == cfg("KEEPER_STRIPE_NAME"),
        "legalBusiness": bool(observed["legalBusiness"]),
        "supportEmail": bool(observed["supportEmail"]) and observed["supportEmail"] == env.get("ZENOD_SUPPORT_EMAIL"),
        "website": (urllib.parse.urlsplit(site_url).hostname or "").endswith(site) and http_ok(site_url),
        "portalActive": observed["portalActive"] is True,
        "terms": on_site(observed["terms"]) and http_ok(observed["terms"]),
        "privacy": on_site(observed["privacy"]) and http_ok(observed["privacy"]),
    }
    return {"ok": all(checks.values()), "checks": checks, "observed": observed, "checkedAt": utc_iso(now_utc())}


# ---------------------------------------------------------------- apply + verify

def apply_and_verify(dok: Dokploy, updates: dict[str, str], renewed: list[str], timeout_s=900) -> dict:
    dok.save_env_and_redeploy(updates, f"readiness-keeper: renew {', '.join(renewed)}")
    deadline, last = time.time() + timeout_s, ""
    time.sleep(15)
    while time.time() < deadline:
        try:
            c = service_container(cfg("KEEPER_ZENOD_SERVICE"))
            live = container_env(c)
            if all(live.get(k) == v for k, v in updates.items()):
                r = http_json(cfg("KEEPER_READINESS_URL"), accept_status=(200, 503))
                ok_ids = {x["id"] for x in r.get("checks", []) if x.get("ok")}
                if r.get("ready") is True and set(renewed) <= ok_ids and http_ok(cfg("KEEPER_ZENOD_HEALTH")):
                    h = http_json(cfg("KEEPER_ZENOD_HEALTH"))
                    return {"container": c, "ready": True, "healthSha": h.get("sha"), "verifiedLiveAt": utc_iso(now_utc())}
                last = f"ready={r.get('ready')}"
            else:
                last = f"container {c} still on old env"
        except Exception as e:  # rolling restart: keep polling
            last = str(e)
        time.sleep(10)
    raise RuntimeError(f"new env not live and ready within {timeout_s}s ({last})")


def write_state(name: str, data: dict) -> None:
    d = Path(cfg("KEEPER_STATE_DIR"))
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f".{name}.tmp"
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    os.replace(tmp, d / name)


def alert_failure(step: str, err: Exception, proofs: list[dict] | None) -> None:
    exp = next((p["expiresAt"] for p in proofs or [] if p["id"] == "backup_restore"), "unknown")
    queue_alert(Path(cfg("KEEPER_ALERT_DIR")), "ALERT",
                f"zenod readiness-keeper FAILED at {step}: {err}. No proof was changed "
                f"(backup_restore expires {exp}); it retries at the next daily run (04:30 Europe/Madrid). "
                "Logs: journalctl -u zenod-readiness-keeper on VPS1.", dry=False)


def cmd_run(a) -> int:
    dok = Dokploy()
    env, now = dok.env(), now_utc()
    proofs = {p["id"]: p for p in proof_status(env, now)}
    do_drill = a.force_drill or due(proofs.get("backup_restore"), float(cfg("KEEPER_DRILL_MIN_AGE_DAYS")))
    do_stripe = a.force_stripe or due(proofs.get("stripe_profile"), float(cfg("KEEPER_STRIPE_MIN_AGE_DAYS")))
    log(f"proofs {json.dumps(list(proofs.values()))}")
    log(f"plan drill={do_drill} stripe={do_stripe} dry={a.dry_run}")
    if not (do_drill or do_stripe):
        return 0
    result, updates, renewed, step = {"startedAt": utc_iso(now)}, {}, [], "start"
    try:
        with lock(Path(cfg("KEEPER_STATE_DIR"))):
            if do_stripe:
                step = "stripe-profile"
                sp = stripe_profile_check(env)
                result["stripeProfile"] = sp
                log(f"stripe profile {json.dumps(sp)}")
                if not sp["ok"]:
                    raise RuntimeError(f"Stripe profile mismatch: {[k for k, v in sp['checks'].items() if not v]}")
                updates["ZENOD_STRIPE_PROFILE_VERIFIED_AT"] = sp["checkedAt"]
                renewed.append("stripe_profile")
            if do_drill:
                step = "backup-drill"
                d = drill(a.dry_run)
                result["drill"] = d
                if not a.dry_run:
                    updates["ZENOD_BACKUP_RESTORE_VERIFIED_AT"] = d["verifiedAt"]
                    renewed.append("backup_restore")
            if a.dry_run or a.no_apply or not updates:
                log(f"not applying (dry={a.dry_run} no_apply={a.no_apply}) would set {updates}")
            else:
                step = "apply-env"
                result["applied"] = updates
                result["live"] = apply_and_verify(dok, updates, renewed)
                log(f"live {json.dumps(result['live'])}")
    except Exception as e:
        result["error"] = f"{step}: {e}"
        log(f"FAILED {result['error']}")
        if not a.dry_run:
            write_state("last-run.json", result)
            alert_failure(step, e, list(proofs.values()))
        return 1
    result["finishedAt"] = utc_iso(now_utc())
    if not a.dry_run:
        write_state("last-run.json", result)
    log("done")
    return 0


def cmd_watch(a) -> int:
    now = parse_iso(a.now) if a.now else now_utc()
    readiness = readiness_err = proofs = env_err = None
    try:
        readiness = http_json(cfg("KEEPER_READINESS_URL"), accept_status=(200, 503))
    except Exception as e:
        readiness_err = str(e)[:160]
    try:
        proofs = proof_status(Dokploy().env(), now)
    except Exception as e:
        env_err = str(e)[:160]
    if a.now:  # simulation: judge the dated proofs at that time, not today's live endpoint
        readiness, readiness_err = None, None
    issues = watch_issues(readiness, readiness_err, proofs, env_err, float(cfg("KEEPER_ALERT_DAYS")))
    sf = Path(cfg("KEEPER_STATE_DIR")) / "watch-state.json"
    state = {} if a.dry_run else (json.loads(sf.read_text()) if sf.exists() else {})
    msgs, new_state = plan_alerts(issues, state, int(now.timestamp()), int(float(cfg("KEEPER_REALERT_HOURS")) * 3600))
    log(f"watch ready={None if readiness is None else readiness.get('ready')} issues={[k for k, _, _ in issues]} "
        f"proofs={json.dumps([{k: p[k] for k in ('id', 'expiresAt', 'daysLeft')} for p in proofs or []])}")
    alert_dir = Path(cfg("KEEPER_ALERT_DIR"))
    for kind, _key, text in msgs:
        queue_alert(alert_dir, kind, text, a.dry_run)
    if not a.dry_run:
        write_state("watch-state.json", new_state)
    return 0


def cmd_status(_a) -> int:
    print(json.dumps(proof_status(Dokploy().env(), now_utc()), indent=2))
    return 0


def cmd_stripe(a) -> int:
    dok = Dokploy()
    sp = stripe_profile_check(dok.env())
    print(json.dumps(sp, indent=2))
    if a.apply and sp["ok"]:
        with lock(Path(cfg("KEEPER_STATE_DIR"))):
            print(json.dumps(apply_and_verify(dok, {"ZENOD_STRIPE_PROFILE_VERIFIED_AT": sp["checkedAt"]},
                                              ["stripe_profile"]), indent=2))
    return 0 if sp["ok"] else 1


def cmd_test_alert(a) -> int:
    queue_alert(Path(cfg("KEEPER_ALERT_DIR")), "TEST",
                f"zenod readiness-keeper alert path test ({a.note}). No action needed.", a.dry_run)
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--dry-run", action="store_true")
    r.add_argument("--no-apply", action="store_true", help="prove but do not write Dokploy env")
    r.add_argument("--force-drill", action="store_true")
    r.add_argument("--force-stripe", action="store_true")
    w = sub.add_parser("watch")
    w.add_argument("--dry-run", action="store_true")
    w.add_argument("--now", help="simulate the dated proofs at this ISO time (implies judging proofs only)")
    sub.add_parser("status")
    s = sub.add_parser("stripe-profile")
    s.add_argument("--apply", action="store_true")
    t = sub.add_parser("test-alert")
    t.add_argument("--dry-run", action="store_true")
    t.add_argument("--note", default="manual")
    a = p.parse_args(argv)
    return {"run": cmd_run, "watch": cmd_watch, "status": cmd_status,
            "stripe-profile": cmd_stripe, "test-alert": cmd_test_alert}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
