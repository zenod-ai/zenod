#!/usr/bin/env python3
"""Scheduled production promote (EPIC-24 M12, root D28): one tick of the hourly timer on VPS3.

Production (zenod-mt) moves only on scripts/promote-production.sh, which gates the sha staging runs (staging
health + the standard question set vs scripts/memory-eval/floor.json) and then re-pins production through the
VPS1 deploy poller, with its own rollback. This tick decides whether to run that script now, so promotes happen
by themselves at a pace VPS1 can carry (infra-vps desk, 2026-11-11: at most one promote per hour). It runs it only
when every rule below holds, in this order, and writes ONE line per tick to ~/zenod-eval/promote-schedule.jsonl:

  locked          another tick (or a manual run holding the same lock) is still going
  vps1-unreachable  VPS1's poller config/state could not be read (so the pause state is unknown)
  staging-down    staging's /api/health does not answer with a sha
  production-unreadable  production's /api/health does not answer with a sha (the rollback needs it)
  nothing-new     staging runs the sha production runs
  quiet-hours     22:00-08:00 Europe/Madrid, unless a fix is waiting: production is unhealthy, or the Delivery
                  Manager touched ~/zenod-eval/promote-now (consumed by the attempt)
  paused          infra-vps paused the zenod-mt promote (hosts/vps1/deploy-poller.json: not in promote_targets)
  batching        staging rolled onto that sha less than ZENOD_TICK_MIN_AGE_MIN (30) minutes ago
  hourly-limit    a promote, rollback or gate run happened less than 60 minutes ago
  gate-failed-earlier  this sha already failed the gate less than ZENOD_TICK_RETRY_H (6) hours ago
  then the attempt: promoted | gate-failed | promote-failed | already | error

A gate failure stops before production is touched (promote-production.sh exits non-zero) and posts nothing to
Jordi: the first failure of a sha leaves one desk note for the Delivery Manager in the zenod repo.

  tick.py             one tick
  tick.py --dry-run   evaluate every rule and print the decision; run nothing, write nothing
  tick.py --dry-run --assume-unpaused   the same, as if infra-vps's pause were off
"""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import json
import os
import shlex
import subprocess
import sys
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

E = os.environ.get
EVAL = Path(E("ZENOD_EVAL", str(Path.home() / "zenod-eval")))
REPO = E("ZENOD_REPO", "/var/lib/vps3-scratch/t3agent/github/zenod")
STAGING_HEALTH = E("ZENOD_STAGING_URL", "http://100.104.206.10:8781") + "/api/health"
PROD_HEALTH = E("ZENOD_PROD_HEALTH", "https://cloud.zenod.dev/api/health")
VPS1 = E("ZENOD_VPS1", "hetzner_vps_1")
MIN_AGE = float(E("ZENOD_TICK_MIN_AGE_MIN", "30"))
GAP_MIN = float(E("ZENOD_TICK_GAP_MIN", "60"))
RETRY_H = float(E("ZENOD_TICK_RETRY_H", "6"))
QUIET = (int(E("ZENOD_TICK_QUIET_FROM", "22")), int(E("ZENOD_TICK_QUIET_TO", "8")))
TZ = ZoneInfo("Europe/Madrid")
LOG = EVAL / "promote-schedule.jsonl"
PROMOTIONS = EVAL / "promotions.jsonl"
FLAG = EVAL / "promote-now"
LOCK = EVAL / "promote.lock"

# Read on VPS1: is the zenod-mt promote paused, and when did staging roll onto which sha.
PROBE = r'''
import json, os
h = os.path.expanduser("~")
c = json.load(open(h + "/github/infra-vps/hosts/vps1/deploy-poller.json"))
s = json.load(open(h + "/.local/state/deploy-poller/state.json")).get("zenod-staging", {})
print(json.dumps({"promote_paused": "zenod-mt" not in [t["name"] for t in c.get("promote_targets", [])],
                  "staging": {"sha": s.get("sha", ""), "at": s.get("at", "")}}))
'''


def now() -> dt.datetime:
    v = E("ZENOD_TICK_NOW")
    return parse_ts(v) if v else dt.datetime.now(dt.timezone.utc)


def parse_ts(v: str) -> dt.datetime:
    return dt.datetime.fromisoformat(v.replace("Z", "+00:00"))


def iso(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def health(url: str) -> dict:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "zenod-promote-tick/1 (EPIC-24 M12)"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)
    except Exception:
        return {}


def vps1_probe() -> dict:
    cmd = E("ZENOD_TICK_VPS1_CMD")
    argv = shlex.split(cmd) if cmd else ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", VPS1, "python3", "-"]
    r = subprocess.run(argv, input=PROBE, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip()[-300:])
    return json.loads(r.stdout)


def jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    out = []
    for line in p.read_text().splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out


def minutes_since(at: str, t: dt.datetime) -> float:
    return (t - parse_ts(at)).total_seconds() / 60


def decide(t: dt.datetime, probe: dict, staging: str, prod: dict, ticks: list[dict], promotions: list[dict],
           flag: bool, assume_unpaused: bool = False) -> tuple[str, dict]:
    """Return (decision, facts); decision 'run' means run the gate now."""
    prod_sha = prod.get("sha", "")
    facts: dict = {"sha": staging, "production": prod_sha}
    if not staging:
        return "staging-down", facts
    if not prod_sha:  # cannot tell what production runs: never promote blind (the rollback needs it)
        return "production-unreadable", facts
    if staging == prod_sha:
        return "nothing-new", facts
    local = t.astimezone(TZ)
    quiet = local.hour >= QUIET[0] or local.hour < QUIET[1]
    fix_waiting = flag or prod.get("status") != "ok"
    if fix_waiting:
        facts["fix_waiting"] = "promote-now flag" if flag else "production unhealthy"
    if quiet and not fix_waiting:
        return "quiet-hours", facts
    if probe.get("promote_paused") and not assume_unpaused:
        return "paused", facts
    # Age of the candidate on staging: VPS1's roll time when it names this sha, else when a tick first saw it.
    rolled = probe.get("staging", {})
    seen = rolled.get("at") if rolled.get("sha") == staging and rolled.get("at") else \
        next((r["at"] for r in ticks if r.get("sha") == staging), iso(t))
    facts["staging_since"] = seen
    age = minutes_since(seen, t)
    if age < MIN_AGE:
        facts["age_min"] = round(age)
        return "batching", facts
    moves = [r["at"] for r in promotions if r.get("action") in ("promote", "rollback", "failed")]
    moves += [r["at"] for r in ticks if r.get("gate_ran")]
    if moves:
        last = max(moves, key=parse_ts)
        if minutes_since(last, t) < GAP_MIN:
            facts["last_move"] = last
            return "hourly-limit", facts
    failed = [r["at"] for r in ticks if r.get("sha") == staging and r.get("decision") == "gate-failed"]
    if failed and minutes_since(max(failed, key=parse_ts), t) < RETRY_H * 60:
        facts["failed_at"] = max(failed, key=parse_ts)
        return "gate-failed-earlier", facts
    return "run", facts


def attempt(sha: str) -> tuple[str, str]:
    """Run the gate + promote; return (outcome, tail of its output)."""
    before = len(jsonl(PROMOTIONS))
    cmd = E("ZENOD_TICK_PROMOTE_CMD")
    if cmd:
        argv = shlex.split(cmd)
    else:  # the script as on origin/main, like the nightly suite, so a merged fix is used on the next tick
        script = EVAL / "promote-production.sh"
        subprocess.run(["git", "-C", REPO, "fetch", "-q", "origin", "main"], check=True, timeout=300)
        script.write_text(subprocess.run(["git", "-C", REPO, "show", "origin/main:scripts/promote-production.sh"],
                                         check=True, capture_output=True, text=True).stdout)
        argv = ["bash", str(script)]
    env = dict(os.environ, ZENOD_REPO=REPO, ZENOD_EVAL=str(EVAL))
    r = subprocess.run([*argv, "--sha", sha], capture_output=True, text=True, env=env, timeout=5400)
    out = (r.stdout + r.stderr).strip()
    tail = " | ".join(out.splitlines()[-6:])[-900:]
    new = jsonl(PROMOTIONS)[before:]
    if r.returncode == 0:
        return ("promoted" if any(x.get("action") == "promote" for x in new) else "already"), tail
    if any(x.get("action") == "failed" for x in new):
        return "promote-failed", tail
    return "gate-failed", tail


def tell_delivery_manager(sha: str, outcome: str, tail: str) -> None:
    """One desk note in the zenod repo (the Delivery Manager reads it on its next wake). Nothing goes to Jordi."""
    cmd = E("ZENOD_TICK_NOTIFY_CMD")
    about = f"Scheduled promote stopped: {outcome} on staging {sha[:7]}"
    body = (f"The hourly promote (EPIC-24 M12, scripts/promote-schedule) ran the gate on staging {sha[:7]} at "
            f"{iso(now())} and stopped: {outcome}. Production was not moved. Output tail: {tail}\n\n"
            f"Log: ~/zenod-eval/promote-schedule.jsonl and ~/zenod-eval/promote/runs on VPS3. The timer retries this sha "
            f"after {RETRY_H:g} h, or at once on a newer staging sha.")
    if cmd:
        argv = [*shlex.split(cmd), about, body]
    else:
        argv = ["python3", str(Path.home() / "github/agent_team/scripts/desk_note.py"), "send", "--to", REPO,
                "--from", "zenod", "--reply-to", "zenod-ai/zenod", "--about", about, "--body", body]
    subprocess.run(argv, capture_output=True, text=True, timeout=120)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--assume-unpaused", action="store_true", help="with --dry-run: as if infra-vps's pause were off")
    a = ap.parse_args(argv)
    if a.assume_unpaused and not a.dry_run:
        ap.error("--assume-unpaused only with --dry-run")
    EVAL.mkdir(parents=True, exist_ok=True)
    t = now()
    line: dict = {"at": iso(t)}

    def write(decision: str, **extra) -> int:
        line.update(decision=decision, **extra)
        print(json.dumps(line))
        if not a.dry_run:
            with LOG.open("a") as f:
                f.write(json.dumps(line) + "\n")
        return 0

    lock = LOCK.open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return write("locked")
    try:
        probe = vps1_probe()
    except Exception as e:  # noqa: BLE001
        return write("vps1-unreachable", detail=str(e)[:300])
    staging = health(STAGING_HEALTH).get("sha", "")
    prod = health(PROD_HEALTH)
    decision, facts = decide(t, probe, staging, prod, jsonl(LOG), jsonl(PROMOTIONS), FLAG.exists(), a.assume_unpaused)
    line.update(facts)
    if decision != "run" or a.dry_run:
        return write(decision if decision != "run" else "would-run")
    flag = FLAG.exists()
    if flag:
        FLAG.unlink()
    try:
        outcome, tail = attempt(staging)
    except Exception as e:  # noqa: BLE001
        outcome, tail = "error", str(e)[:600]
    line["finished"] = iso(dt.datetime.now(dt.timezone.utc))
    if outcome in ("gate-failed", "promote-failed", "error") and not any(
            r.get("sha") == staging and r.get("decision") == outcome for r in jsonl(LOG)):
        tell_delivery_manager(staging, outcome, tail)
        line["told"] = "desk note to the Delivery Manager"
    return write(outcome, gate_ran=True, detail=tail)


if __name__ == "__main__":
    sys.exit(main())
