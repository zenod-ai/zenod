#!/usr/bin/env bash
# zenod-watchdog — Epic-1 closure gate C-24/C-25 (#570 / W2-1 / W2-3).
#
# The system must report its OWN outages. This watchdog lives OUTSIDE the stack it
# watches — it is a host systemd timer, NOT a container — so it survives the exact failure
# that took the box dark on 2026-07-04 (disk full → dockerd down → every container,
# including Phylax, unreachable). It checks the host + stack every run and, on a real
# problem, pages Jordi WITHIN MINUTES, unprompted:
#
#   • dead docker daemon / dead stack   → CRITICAL
#   • container crash-loop (>N restarts in the window) → CRITICAL
#   • disk headroom (warn ≥80%, page ≥90%)            → WARN / CRITICAL
#   • dead public endpoint (c1/z2 health != 200)      → CRITICAL
#
# Alert routing is two-tier so a down stack can still page:
#   primary  = Phylax /api/notify  (→ WhatsApp; works while the Console is up)
#   fallback = an out-of-band webhook (ntfy/Telegram/…) that needs only host network,
#              used when the Console is unreachable (the "dead stack" case).
#
# Pure evaluation logic (thresholds, crash-loop delta, dedup) is exercised by
# scripts/watchdog/watchdog-logic.test.sh so the decision rules are tested, not just live.
set -uo pipefail

CONFIG="${ZENOD_WATCHDOG_ENV:-/etc/zenod-watchdog.env}"
# shellcheck disable=SC1090
[ -f "$CONFIG" ] && . "$CONFIG"

# --- config (env-overridable; safe defaults) -------------------------------------------
NOTIFY_URL="${ZENOD_NOTIFY_URL:-https://c1.zenod.dev}"
NOTIFY_TOKEN="${ZENOD_NOTIFY_TOKEN:-}"
FALLBACK_URL="${ZENOD_WATCHDOG_FALLBACK_URL:-}"       # out-of-band POST target (ntfy topic / Telegram sendMessage / …)
HEALTH_URLS="${ZENOD_WATCHDOG_HEALTH_URLS:-https://c1.zenod.dev/api/health https://z2.zenod.dev/api/health}"
WATCH_CONTAINERS="${ZENOD_WATCHDOG_CONTAINERS:-zenod-console zenod-z2 zenod-phylax zenod-epaminon zenod-archus2 zenod-outbound zenod-agent-runner}"
DISK_PATHS="${ZENOD_WATCHDOG_DISK_PATHS:-/ /var/lib/docker}"
DISK_WARN="${ZENOD_WATCHDOG_DISK_WARN:-80}"
DISK_PAGE="${ZENOD_WATCHDOG_DISK_PAGE:-90}"
RESTART_MAX="${ZENOD_WATCHDOG_RESTART_MAX:-5}"        # crash-loop: >this many restarts within the window
STATE_DIR="${ZENOD_WATCHDOG_STATE_DIR:-/var/lib/zenod-watchdog}"
REALERT_SECS="${ZENOD_WATCHDOG_REALERT_SECS:-1800}"  # re-page an ongoing problem every 30 min

mkdir -p "$STATE_DIR" 2>/dev/null || STATE_DIR="$(mktemp -d)"
NOW="$(date +%s)"
DOCKER="docker"; command -v docker >/dev/null 2>&1 || DOCKER="sudo docker"

log() { echo "[watchdog $(date -u +%FT%TZ)] $*"; }

# --- pure decision helpers (unit-tested) -----------------------------------------------
# disk_level PERCENT WARN PAGE -> "ok" | "warn" | "page"
disk_level() {
  local pct="$1" warn="$2" page="$3"
  if [ "$pct" -ge "$page" ]; then echo page
  elif [ "$pct" -ge "$warn" ]; then echo warn
  else echo ok; fi
}
# crashloop RESTARTS_NOW RESTARTS_PREV MAX -> "yes" | "no"  (delta over the window)
crashloop() {
  local now="$1" prev="$2" max="$3"
  [ "$((now - prev))" -gt "$max" ] && echo yes || echo no
}

# --- alert (dedup + re-alert + two-tier routing) ---------------------------------------
# alert KEY SEVERITY TEXT  — SEVERITY is "warn" (info) | "page" (action)
alert() {
  local key="$1" severity="$2" text="$3"
  local statef="$STATE_DIR/alert.$key"
  local last=0; [ -f "$statef" ] && last="$(cat "$statef" 2>/dev/null || echo 0)"
  # Suppress repeats unless the problem has persisted past the re-alert interval.
  if [ "$((NOW - last))" -lt "$REALERT_SECS" ]; then return 0; fi
  echo "$NOW" > "$statef"
  local body="🚨 zenod-watchdog: $text"
  [ "$severity" = "warn" ] && body="⚠️ zenod-watchdog: $text"
  local sev="action"; [ "$severity" = "warn" ] && sev="info"
  log "ALERT[$severity/$key] $text"
  local delivered="no"
  # Primary: Phylax /api/notify (only worth trying if the Console is reachable).
  if [ -n "$NOTIFY_TOKEN" ] && curl -fsS -m 8 -o /dev/null "$NOTIFY_URL/api/health" 2>/dev/null; then
    if curl -fsS -m 12 -X POST "$NOTIFY_URL/api/notify" \
        -H "Authorization: Bearer $NOTIFY_TOKEN" -H "Content-Type: application/json" \
        -d "$(printf '{"text":%s,"severity":"%s","eventType":"watchdog","dedupeKey":"watchdog:%s"}' "$(json_str "$body")" "$sev" "$key")" \
        >/dev/null 2>&1; then delivered="phylax"; fi
  fi
  # Fallback: out-of-band webhook (the "dead stack" path). Plain text body — works for
  # ntfy.sh topics and most simple webhooks; Telegram uses ?text= so keep it in the URL.
  if [ "$delivered" = "no" ] && [ -n "$FALLBACK_URL" ]; then
    if curl -fsS -m 12 -X POST "$FALLBACK_URL" -H "Content-Type: text/plain" --data "$body" >/dev/null 2>&1; then
      delivered="fallback"; fi
  fi
  log "  delivery=$delivered"
  [ "$delivered" != "no" ]
}
# minimal JSON string escaper (quotes + backslashes + newlines)
json_str() { printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$1"; }

clear_alert() { rm -f "$STATE_DIR/alert.$1" 2>/dev/null; }

# --- checks -----------------------------------------------------------------------------
# Sourced with ZENOD_WATCHDOG_LIB_ONLY=1 (the unit test) → expose the pure helpers above
# without running any live check.
if [ "${ZENOD_WATCHDOG_LIB_ONLY:-}" = "1" ]; then return 0 2>/dev/null || exit 0; fi

problems=0

# 1) docker daemon / dead stack
if ! systemctl is-active --quiet docker 2>/dev/null; then
  problems=$((problems+1))
  alert docker-dead page "Docker daemon is DOWN on the host — the whole stack is dark. (systemctl is-active docker != active)"
  # Nothing container-level to check if docker is down; endpoints will also fail below.
else
  clear_alert docker-dead
fi

# 2) disk headroom (+ prevents the #570 disk-full recurrence being silent)
for p in $DISK_PATHS; do
  pct="$(df --output=pcent "$p" 2>/dev/null | tail -1 | tr -dc '0-9')"
  [ -z "$pct" ] && continue
  lvl="$(disk_level "$pct" "$DISK_WARN" "$DISK_PAGE")"
  key="disk$(echo "$p" | tr -c 'a-zA-Z0-9' '-')"
  case "$lvl" in
    page) problems=$((problems+1)); alert "$key" page "Disk ${p} at ${pct}% (≥${DISK_PAGE}%). Runaway logs/data will take the box down — free space now (#570).";;
    warn) alert "$key" warn "Disk ${p} at ${pct}% (≥${DISK_WARN}%). Headroom low; check log growth.";;
    ok)   clear_alert "$key";;
  esac
done

# 3) container crash-loops (restart delta over the timer window)
if systemctl is-active --quiet docker 2>/dev/null; then
  for c in $WATCH_CONTAINERS; do
    rc="$($DOCKER inspect -f '{{.RestartCount}}' "$c" 2>/dev/null)"
    [ -z "$rc" ] && continue   # not present on this host — skip, don't false-page
    prevf="$STATE_DIR/restarts.$c"; prev=0; [ -f "$prevf" ] && prev="$(cat "$prevf" 2>/dev/null || echo 0)"
    echo "$rc" > "$prevf"
    if [ "$(crashloop "$rc" "$prev" "$RESTART_MAX")" = "yes" ]; then
      problems=$((problems+1))
      alert "crashloop-$c" page "Container ${c} is CRASH-LOOPING ($((rc - prev)) restarts since last check, RestartCount=$rc)."
    else
      clear_alert "crashloop-$c"
    fi
  done
fi

# 4) public endpoint health (dead channel / dead stack even if docker looks up)
for u in $HEALTH_URLS; do
  code="$(curl -fsS -m 8 -o /dev/null -w '%{http_code}' "$u" 2>/dev/null || echo 000)"
  key="health$(echo "$u" | tr -c 'a-zA-Z0-9' '-')"
  if [ "$code" != "200" ]; then
    problems=$((problems+1))
    alert "$key" page "Endpoint ${u} returned ${code} (expected 200) — a channel/agent is dark."
  else
    clear_alert "$key"
  fi
done

# 5) C-25 credit headroom (ledger-driven, warn-level; skipped unless a budget is configured
#    server-side). The Console does the projection; the watchdog just relays the warning.
if [ -n "$NOTIFY_TOKEN" ]; then
  hr="$(curl -fsS -m 8 -H "Authorization: Bearer $NOTIFY_TOKEN" "$NOTIFY_URL/api/usage/headroom" 2>/dev/null || echo '')"
  if printf '%s' "$hr" | grep -q '"level":"warn"'; then
    msg="$(printf '%s' "$hr" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("message",""))' 2>/dev/null)"
    alert credit-headroom warn "${msg:-Credit burn is high (C-25).}"
  else
    clear_alert credit-headroom
  fi
fi

if [ "$problems" -eq 0 ]; then log "all healthy"; fi
exit 0
