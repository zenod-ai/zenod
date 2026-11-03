#!/usr/bin/env bash
# zenod-alert — the one sender for Zenod health alerts (EPIC-6 S5).
#
# Delivers to Jordi through the agent team's HQ alert queue on VPS1 (~/agent_team_m0/alerts.pending), which the
# relay watchdog sends to the T3 thread "HQ — vps1 alerts" (it logs `alert=sent id=<id>` in relay-watchdog.log).
# Never through Zenod's own WhatsApp or Telegram: Zenod's chat path only captures (root L-6).
#
# Same rules for every caller (the host watchdog and the live health page):
#   • dedupe by KEY: one alert when a problem starts, then again only every REALERT_SECS (30 min) while it lasts;
#   • one [RECOVERED] message when a KEY that alerted is healthy again (with the time it went red);
#   • a KEY is red while any caller still sees it red (EPIC-6 S4): the watchdog's own green check does not recover a
#     row the page still has red (e.g. from a failed smoke check), and vice versa; a caller that has not said red for
#     ZA_CLAIM_SECS (30 min) no longer holds the KEY, so a caller that stopped running cannot keep it red forever;
#   • names, counts and timestamps only, never a secret; one line, at most MAX_CHARS characters.
#
#   zenod-alert.sh alert KEY warn|page TEXT     # queue [WARN]/[ALERT] unless deduped
#   zenod-alert.sh clear KEY TEXT               # queue [RECOVERED] if KEY had alerted, then forget it
#   zenod-alert.sh rows < rows.json             # live page: [{"key":"row-2","name":..,"colour":..,"signal":..}, ...]
#                                               # red → alert KEY page; any other colour → clear KEY
#
# Every alert logs "ALERT[sev/key] text" and "delivery=hq-queue id=<id>" (or "delivery=no reason=...") to stdout and
# $ZA_STATE/alert.log, so the page can check each id against the relay's `alert=sent id=<id>`. Sourced with
# ZENOD_ALERT_LIB_ONLY=1 it only defines functions.
set -uo pipefail

ZA_BASE="${ZENOD_ALERT_BASE:-$HOME/agent_team_m0}"
ZA_QUEUE="${ZENOD_ALERT_QUEUE:-$ZA_BASE/alerts.pending}"
ZA_STATE="${ZENOD_ALERT_STATE_DIR:-$HOME/.local/state/zenod-alert}"
ZA_REALERT="${ZENOD_ALERT_REALERT_SECS:-1800}"
ZA_MAX_CHARS="${ZENOD_ALERT_MAX_CHARS:-600}"
ZA_SOURCE="${ZENOD_ALERT_SOURCE:-zenod}"      # shown in the message, e.g. "zenod watchdog" or "zenod health page"
ZA_CLAIM="${ZENOD_ALERT_CLAIM_SECS:-1800}"

# Every line also goes to $ZA_STATE/alert.log (both callers), which the live page reads for its watchdog row.
za_log() {
  local line="[zenod-alert $(date -u +%FT%TZ)] $*" lf="$ZA_STATE/alert.log"
  echo "$line"
  mkdir -p "$ZA_STATE" 2>/dev/null && echo "$line" >> "$lf" 2>/dev/null
  if [ "$(stat -c %s "$lf" 2>/dev/null || echo 0)" -gt 1000000 ]; then
    tail -n 5000 "$lf" > "$lf.tmp" 2>/dev/null && mv -f "$lf.tmp" "$lf"
  fi
}
za_now() { echo "${ZENOD_ALERT_NOW:-$(date +%s)}"; }
za_fmt() { date -u -d "@$1" +'%Y-%m-%d %H:%M UTC' 2>/dev/null || echo "$1"; }

# za_clean TEXT -> one line, no control characters, at most ZA_MAX_CHARS characters
za_clean() {
  printf '%s' "$1" | tr '\r\n\t' '   ' | tr -d '\000-\037' | sed 's/  */ /g; s/^ //; s/ $//' | cut -c1-"$ZA_MAX_CHARS"
}

# za_key KEY -> a safe file-name form of KEY
za_key() { printf '%s' "$1" | tr -c 'a-zA-Z0-9._-' '-' | cut -c1-80; }

# za_due NOW LAST REALERT -> "yes" | "no"   (pure dedupe rule, unit-tested)
za_due() {
  local now="$1" last="$2" every="$3"
  if [ "$last" -le 0 ] || [ "$((now - last))" -ge "$every" ]; then echo yes; else echo no; fi
}

# State file per KEY: "FIRST LAST SOURCES SEEN" (SOURCES = comma list of callers that see it red, SEEN = when one
# last said red). Files written before S4 hold only "FIRST LAST" and recover on the first clear, as before.
za_me() { za_key "$ZA_SOURCE"; }
# za_srcs_add LIST ITEM / za_srcs_del LIST ITEM -> comma list (pure, unit-tested)
za_srcs_add() { case ",$1," in *",$2,"*) echo "$1";; *) echo "${1:+$1,}$2";; esac; }
za_srcs_del() { printf '%s' ",$1," | sed "s/,$2,/,/g; s/^,//; s/,\$//"; }

# za_queue KIND TEXT -> writes one queue file atomically, prints its id; non-zero if it could not
za_queue() {
  local kind="$1" text="$2" now id tmp
  now="$(za_now)"; id="${now}-$(date +%N)-${kind}"
  mkdir -p "$ZA_QUEUE" 2>/dev/null || return 1
  # Temp file beside the queue (same filesystem, so mv is atomic), never inside it: the relay deletes
  # leftover .tmp-* files in the queue and must never see a half-written alert.
  tmp="$(dirname "$ZA_QUEUE")/.zenod-alert-$$-$RANDOM"
  printf '[%s] %s\n' "$kind" "$text" > "$tmp" 2>/dev/null && [ -s "$tmp" ] && mv -f "$tmp" "$ZA_QUEUE/$id.msg" \
    || { rm -f "$tmp"; return 1; }
  echo "$id"
}

# za_alert KEY warn|page TEXT -> 0 if queued or deduped, 1 if it should have been sent and could not be
za_alert() {
  local key sev="$2" text now first=0 last=0 srcs="" seen="" kind id
  key="$(za_key "$1")"; text="$(za_clean "$3")"; now="$(za_now)"
  mkdir -p "$ZA_STATE" 2>/dev/null
  [ -f "$ZA_STATE/alert.$key" ] && read -r first last srcs seen < "$ZA_STATE/alert.$key" 2>/dev/null
  first="${first:-0}"; last="${last:-$first}"
  srcs="$(za_srcs_add "$srcs" "$(za_me)")"
  if [ "$(za_due "$now" "$last" "$ZA_REALERT")" != yes ]; then
    echo "$first $last $srcs $now" > "$ZA_STATE/alert.$key"
    return 0
  fi
  [ "$first" -gt 0 ] 2>/dev/null || first="$now"
  kind=ALERT; [ "$sev" = warn ] && kind=WARN
  local msg="$ZA_SOURCE: $text"
  [ "$first" != "$now" ] && msg="$msg (still red, since $(za_fmt "$first"))"
  za_log "ALERT[$sev/$key] $text"
  if id="$(za_queue "$kind" "$msg")"; then
    echo "$first $now $srcs $now" > "$ZA_STATE/alert.$key"
    za_log "  delivery=hq-queue id=$id"
  else
    za_log "  delivery=no reason=queue-not-writable ($ZA_QUEUE)"
    return 1
  fi
}

# za_clear KEY TEXT -> one [RECOVERED] if KEY had alerted; silent otherwise
za_clear() {
  local key text first=0 last=0 srcs="" seen="" rest id
  key="$(za_key "$1")"; text="$(za_clean "$2")"
  [ -f "$ZA_STATE/alert.$key" ] || return 0
  read -r first last srcs seen < "$ZA_STATE/alert.$key" 2>/dev/null
  rest="$(za_srcs_del "$srcs" "$(za_me)")"
  if [ -n "$rest" ] && [ "$(( $(za_now) - ${seen:-0} ))" -lt "$ZA_CLAIM" ]; then
    # another caller still sees KEY red: only drop this caller's claim, no RECOVERED yet
    [ "$rest" = "$srcs" ] || echo "$first $last $rest $seen" > "$ZA_STATE/alert.$key"
    return 0
  fi
  za_log "RECOVERED[$key] $text"
  if id="$(za_queue RECOVERED "$ZA_SOURCE: $text (red since $(za_fmt "${first:-0}"), green at $(za_fmt "$(za_now)"))")"; then
    rm -f "$ZA_STATE/alert.$key"
    za_log "  delivery=hq-queue id=$id"
  else
    za_log "  delivery=no reason=queue-not-writable ($ZA_QUEUE)"   # state kept: retried on the next healthy run
    return 1
  fi
}

# za_rows < JSON list of page rows -> alert every red row, clear every other row
za_rows() {
  local rc=0 key colour line
  while IFS=$'\t' read -r key colour line; do
    [ -n "$key" ] || continue
    if [ "$colour" = red ]; then za_alert "$key" page "$line" || rc=1
    else za_clear "$key" "${line%% is red*} is $colour again" || rc=1; fi
  done < <(python3 -c '
import json, sys
for r in json.load(sys.stdin):
    print("\t".join(str(x).replace("\t", " ").replace("\n", " ") for x in
                    (r["key"], r["colour"], r["name"] + " is red: " + str(r.get("signal", "")))))')
  return $rc
}

if [ "${ZENOD_ALERT_LIB_ONLY:-}" = "1" ]; then return 0 2>/dev/null || exit 0; fi

case "${1:-}" in
  alert) [ $# -eq 4 ] || { echo "usage: $0 alert KEY warn|page TEXT" >&2; exit 2; }; za_alert "$2" "$3" "$4" ;;
  clear) [ $# -eq 3 ] || { echo "usage: $0 clear KEY TEXT" >&2; exit 2; }; za_clear "$2" "$3" ;;
  rows)  za_rows ;;
  *) echo "usage: $0 alert KEY warn|page TEXT | clear KEY TEXT | rows < rows.json" >&2; exit 2 ;;
esac
