#!/usr/bin/env bash
# zenod-watchdog — Zenod's host-level self-outage reporter (Epic-1 C-24/C-25, repointed in EPIC-6 S5).
#
# The system must report its OWN outages. This watchdog lives OUTSIDE the stack it watches — a systemd timer on
# VPS1, NOT a container — so it survives the exact failure that took the box dark on 2026-07-04 (disk full →
# dockerd down → every container unreachable). Since S5 it runs as a user timer of the account that owns the HQ
# alert queue (zenod-health-watchdog.timer), so it needs no root: only the narrow read-only sudo rules for swarm tasks.
#
# Every 2 minutes it checks today's components, under the same keys as the live page's rows (health.zenod.dev):
#   • row-1   zenod.dev answers 200 with a Zenod title                               → page
#   • row-2   cloud.zenod.dev/api/health answers 200 "ok"                             → page
#   • row-4   phylax.zenod.dev/api/health answers 200 "ok", WhatsApp connected        → page
#   • row-11  cloudflared-vps1-sites.service is active (the ingress tunnel)           → page
#   • row-12  root disk below 90% (warn from 80% under disk-warn-root)                → page / warn
#   • docker-dead  the Docker daemon is down: the whole stack is dark                 → page
#   • crashloop-<svc>  ≥ RESTART_MAX failed tasks of the zenod-mt or phylax service in RESTART_WINDOW → page
#   • extra URLs (ZENOD_WATCHDOG_EXTRA_URLS="key=url ...") answer 200 (used for the S5 proof)  → page
#
# Alerts go through scripts/watchdog/zenod-alert.sh (the HQ queue, dedupe, 30-min re-alert, one RECOVERED message).
# A row key is shared with the live page, so one outage seen by both alerts once.
#
# Pure evaluation logic (thresholds, crash-loop rule, dedupe) is exercised by
# scripts/watchdog/watchdog-logic.test.sh so the decision rules are tested, not just live.
set -uo pipefail

CONFIG="${ZENOD_WATCHDOG_ENV:-$HOME/.config/zenod-watchdog.env}"
# shellcheck disable=SC1090
[ -f "$CONFIG" ] && . "$CONFIG"

# --- config (env-overridable; safe defaults) -------------------------------------------
SITE_URL="${ZENOD_WATCHDOG_SITE_URL:-https://zenod.dev/}"
CLOUD_URL="${ZENOD_WATCHDOG_CLOUD_URL:-https://cloud.zenod.dev/api/health}"
PHYLAX_URL="${ZENOD_WATCHDOG_PHYLAX_URL:-https://phylax.zenod.dev/api/health}"
EXTRA_URLS="${ZENOD_WATCHDOG_EXTRA_URLS:-}"
INGRESS_UNIT="${ZENOD_WATCHDOG_INGRESS_UNIT:-cloudflared-vps1-sites.service}"
WATCH_SERVICES="${ZENOD_WATCHDOG_SERVICES:-zenod-mt-fxpzoo=cloud app-index-back-end-panel-6zm3qg=phylax}"
DISK_PATH="${ZENOD_WATCHDOG_DISK_PATH:-/}"
DISK_WARN="${ZENOD_WATCHDOG_DISK_WARN:-80}"
DISK_PAGE="${ZENOD_WATCHDOG_DISK_PAGE:-90}"
RESTART_MAX="${ZENOD_WATCHDOG_RESTART_MAX:-3}"         # crash-loop: at least this many failed tasks ...
RESTART_WINDOW="${ZENOD_WATCHDOG_RESTART_WINDOW:-900}" # ... within this many seconds
export ZENOD_ALERT_SOURCE="${ZENOD_ALERT_SOURCE:-zenod watchdog}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
ZENOD_ALERT_LIB_ONLY=1 . "$HERE/zenod-alert.sh"

log() { echo "[watchdog $(date -u +%FT%TZ)] $*"; }

# --- pure decision helpers (unit-tested) -----------------------------------------------
# disk_level PERCENT WARN PAGE -> "ok" | "warn" | "page"
disk_level() {
  local pct="$1" warn="$2" page="$3"
  if [ "$pct" -ge "$page" ]; then echo page
  elif [ "$pct" -ge "$warn" ]; then echo warn
  else echo ok; fi
}
# crashloop FAILED_TASKS_IN_WINDOW MAX -> "yes" | "no"
crashloop() {
  [ "$1" -ge "$2" ] && echo yes || echo no
}
# failed_tasks NOW WINDOW < "exit|state|timestamp" lines -> count of failed tasks that ended inside the window
# (a swarm task that crashed: state failed/rejected or a non-zero exit; a normal roll is "shutdown" with exit 0)
failed_tasks() {
  python3 -c '
import datetime as dt, re, sys
now, win = int(sys.argv[1]), int(sys.argv[2]); n = 0
for line in sys.stdin:
    p = line.strip().split("|")
    if len(p) < 3:
        continue
    code, state, ts = p[0], p[1], p[2]
    m = re.match(r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)", ts)
    if not m:
        continue
    t = dt.datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S").replace(tzinfo=dt.timezone.utc).timestamp()
    if now - t <= win and (state in ("failed", "rejected") or code not in ("", "0")):
        n += 1
print(n)' "$1" "$2"
}
# health_verdict KIND HTTP_CODE BODY -> "ok" | reason   (KIND: site | health | phylax | plain)
health_verdict() {
  python3 -c '
import json, re, sys
kind, code, body = sys.argv[1], sys.argv[2], sys.stdin.read()
if code != "200":
    print("answered " + code + " (expected 200)"); sys.exit()
if kind == "site":
    m = re.search(r"<title>(.*?)</title>", body, re.S)
    print("ok" if m and "Zenod" in m.group(1) else "answered 200 without a Zenod title"); sys.exit()
if kind == "plain":
    print("ok"); sys.exit()
try:
    j = json.loads(body)
except ValueError:
    print("answered 200 but not health JSON"); sys.exit()
if j.get("status") != "ok":
    print("reports status " + str(j.get("status"))[:20]); sys.exit()
if kind == "phylax":
    wa = ((j.get("channels") or {}).get("whatsapp") or {}).get("state")
    if wa != "connected":
        print("WhatsApp " + str(wa)[:20] + ", not connected"); sys.exit()
print("ok")' "$1" "$2"
}

# --- checks -----------------------------------------------------------------------------
# Sourced with ZENOD_WATCHDOG_LIB_ONLY=1 (the unit test) → expose the pure helpers above
# without running any live check.
if [ "${ZENOD_WATCHDOG_LIB_ONLY:-}" = "1" ]; then return 0 2>/dev/null || exit 0; fi

NOW="$(date +%s)"
problems=0
page() { problems=$((problems+1)); za_alert "$1" page "$2"; }

# fetch URL -> sets CODE and BODY (one retry after 5 s, so a single dropped request does not page)
fetch() {
  local tmp; tmp="$(mktemp)"
  for _ in 1 2; do
    CODE="$(curl -sS -m 10 -A zenod-watchdog -o "$tmp" -w '%{http_code}' "$1" 2>/dev/null || true)"
    [ "${CODE:-000}" = 200 ] && break
    sleep "${ZENOD_WATCHDOG_RETRY_SECS:-5}"
  done
  CODE="${CODE:-000}"; BODY="$(head -c 400000 "$tmp")"; rm -f "$tmp"
}
url_check() { # url_check KEY KIND URL NAME
  fetch "$3"
  local v; v="$(printf '%s' "$BODY" | health_verdict "$2" "$CODE")"
  if [ "$v" = ok ]; then za_clear "$1" "$4 is green again: $3 answers 200"
  else page "$1" "$4 is red: $3 $v"; fi
}

# 1) docker daemon / dead stack
docker_up=no
if systemctl is-active --quiet docker 2>/dev/null; then
  docker_up=yes
  za_clear docker-dead "Docker daemon on VPS1 is running again"
else
  page docker-dead "Docker daemon on VPS1 is DOWN: the whole Zenod stack is dark"
fi

# 2) public endpoints, as the live page's rows 1, 2 and 4
url_check row-1 site "$SITE_URL" "Marketing site zenod.dev"
url_check row-2 health "$CLOUD_URL" "Cloud app cloud.zenod.dev"
url_check row-4 phylax "$PHYLAX_URL" "WhatsApp relay Phylax"
for kv in $EXTRA_URLS; do url_check "${kv%%=*}" plain "${kv#*=}" "Test target ${kv%%=*}"; done

# 3) ingress tunnel (row 11)
if systemctl is-active --quiet "$INGRESS_UNIT" 2>/dev/null; then
  za_clear row-11 "Ingress tunnel is green again: $INGRESS_UNIT active"
else
  page row-11 "Ingress tunnel is red: $INGRESS_UNIT is $(systemctl is-active "$INGRESS_UNIT" 2>/dev/null)"
fi

# 4) disk headroom (row 12; the #570 disk-full recurrence must not be silent)
pct="$(df -P "$DISK_PATH" 2>/dev/null | awk 'NR==2{print $5}' | tr -dc '0-9')"
if [ -n "$pct" ]; then
  case "$(disk_level "$pct" "$DISK_WARN" "$DISK_PAGE")" in
    page) page row-12 "Host VPS1 is red: disk $DISK_PATH at ${pct}% (from ${DISK_PAGE}%). Free space now (#570)";;
    warn) za_clear row-12 "Host VPS1 disk below ${DISK_PAGE}% again (${pct}%)"
          za_alert disk-warn-root warn "Host VPS1 disk $DISK_PATH at ${pct}% (from ${DISK_WARN}%). Check log growth";;
    ok)   za_clear row-12 "Host VPS1 disk is green again (${pct}%)"
          za_clear disk-warn-root "Host VPS1 disk is green again (${pct}%)";;
  esac
fi

# 5) crash-loops of the swarm services (read-only sudo rules: service ls / service ps / inspect --type task)
if [ "$docker_up" = yes ]; then
  svcs="$(sudo -n docker service ls --format '{{.ID}} {{.Name}}' 2>/dev/null | awk '{print $2}')"
  for sv in $WATCH_SERVICES; do
    svc="${sv%%=*}"; label="${sv#*=}"
    printf '%s\n' "$svcs" | grep -qx "$svc" || continue   # not on this host: skip, don't false-page
    # shellcheck disable=SC2046
    tasks="$(sudo -n docker service ps -q --no-trunc "$svc" 2>/dev/null)"
    [ -n "$tasks" ] || continue
    # shellcheck disable=SC2086
    n="$(sudo -n docker inspect --type task --format '{{.ServiceID}}|{{.Status.ContainerStatus.ContainerID}}|{{.Status.ContainerStatus.ExitCode}}|{{.Status.State}}|{{.DesiredState}}|{{.Status.Timestamp}}' $tasks 2>/dev/null \
         | awk -F'|' '{print $3"|"$4"|"$6}' | failed_tasks "$NOW" "$RESTART_WINDOW")"
    if [ "$(crashloop "${n:-0}" "$RESTART_MAX")" = yes ]; then
      page "crashloop-$label" "The $label service is CRASH-LOOPING: $n failed tasks in the last $((RESTART_WINDOW / 60)) min"
    else
      za_clear "crashloop-$label" "The $label service is stable again"
    fi
  done
fi

if [ "$problems" -eq 0 ]; then log "all healthy"; fi
exit 0
