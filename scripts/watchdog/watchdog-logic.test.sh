#!/usr/bin/env bash
# Unit test for zenod-watchdog's decision logic and the zenod-alert sender (Epic-1 C-24 · #570 · EPIC-6 S5).
# Sources the watchdog in LIB_ONLY mode so no live check runs, then asserts the threshold, crash-loop and health
# rules, and drives zenod-alert.sh against a temp queue (dedupe, 30-min re-alert, one RECOVERED, page rows).
# Run: bash scripts/watchdog/watchdog-logic.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ZENOD_WATCHDOG_LIB_ONLY=1 . "$HERE/zenod-watchdog.sh"

fail=0
check() { # check DESC EXPECTED ACTUAL
  if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1 (expected '$2', got '$3')"; fail=1; fi
}

# disk_level PCT WARN PAGE
check "disk 22% is ok"          ok   "$(disk_level 22 80 90)"
check "disk 80% warns"          warn "$(disk_level 80 80 90)"
check "disk 85% warns"          warn "$(disk_level 85 80 90)"
check "disk 90% pages"          page "$(disk_level 90 80 90)"
check "disk 97% pages"          page "$(disk_level 97 80 90)"
check "disk 79% is ok"          ok   "$(disk_level 79 80 90)"

# crashloop FAILED MAX  (failed tasks in the window >= MAX => crash-loop)
check "0 failed tasks: no"      no   "$(crashloop 0 3)"
check "2 failed tasks: no"      no   "$(crashloop 2 3)"
check "3 failed tasks: yes"     yes  "$(crashloop 3 3)"

# failed_tasks NOW WINDOW < "exit|state|timestamp"
now=$(date -u -d '2026-11-03 12:00:00' +%s)
tasks='0|running|2026-11-03 11:58:00.1 +0000 UTC
0|shutdown|2026-11-03 11:57:00.1 +0000 UTC
137|failed|2026-11-03 11:56:00.1 +0000 UTC
1|shutdown|2026-11-03 11:55:00.1 +0000 UTC
0|rejected|2026-11-03 11:54:00.1 +0000 UTC
1|failed|2026-11-03 10:00:00.1 +0000 UTC'
check "a normal roll (shutdown, exit 0) is not a failure; old failures are outside the window" 3 \
  "$(printf '%s\n' "$tasks" | failed_tasks "$now" 900)"

# health_verdict KIND CODE < BODY
check "site 200 with Zenod title"  ok "$(echo '<title>Zenod · memory</title>' | health_verdict site 200)"
check "site 200 without title"     "answered 200 without a Zenod title" "$(echo '<html>' | health_verdict site 200)"
check "cloud 502"                  "answered 502 (expected 200)" "$(echo 'bad' | health_verdict health 502)"
check "cloud 200 ok"               ok "$(echo '{"status":"ok"}' | health_verdict health 200)"
check "cloud 200 degraded"         "reports status degraded" "$(echo '{"status":"degraded"}' | health_verdict health 200)"
check "phylax WhatsApp connected"  ok "$(echo '{"status":"ok","channels":{"whatsapp":{"state":"connected"}}}' | health_verdict phylax 200)"
check "phylax WhatsApp closed"     "WhatsApp closed, not connected" \
  "$(echo '{"status":"ok","channels":{"whatsapp":{"state":"closed"}}}' | health_verdict phylax 200)"
check "plain target 404"           "answered 404 (expected 200)" "$(echo '' | health_verdict plain 404)"

# za_due NOW LAST EVERY
check "never alerted: due"         yes "$(za_due 1000 0 1800)"
check "10 min later: deduped"      no  "$(za_due 1600 1000 1800)"
check "30 min later: re-alert"     yes "$(za_due 2800 1000 1800)"

# zenod-alert.sh end to end, against a temp queue and state dir
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export ZENOD_ALERT_QUEUE="$T/base/alerts.pending" ZENOD_ALERT_STATE_DIR="$T/state" ZENOD_ALERT_SOURCE="zenod test"
A="$HERE/zenod-alert.sh"
export ZENOD_ALERT_HOLD_SECS=0   # the cases below test dedupe and recovery; the hold-down has its own block further down
q() { ls "$ZENOD_ALERT_QUEUE" 2>/dev/null | wc -l | tr -d ' '; }
ZENOD_ALERT_NOW=1000 bash "$A" alert row-2 page "Cloud app is red: answered 502" >/dev/null
check "first red queues one alert" 1 "$(q)"
check "the queue file is one [ALERT] line with the source" "[ALERT] zenod test: Cloud app is red: answered 502" \
  "$(cat "$ZENOD_ALERT_QUEUE"/*-ALERT.msg)"
ZENOD_ALERT_NOW=1600 bash "$A" alert row-2 page "Cloud app is red: answered 502" >/dev/null
check "red again 10 min later is deduped" 1 "$(q)"
ZENOD_ALERT_NOW=2800 bash "$A" alert row-2 page "Cloud app is red: answered 502" >/dev/null
check "red 30 min later re-alerts" 2 "$(q)"
check "the re-alert says since when" 1 "$(grep -l 'still red, since 1970-01-01 00:16 UTC' "$ZENOD_ALERT_QUEUE"/*.msg | wc -l | tr -d ' ')"
ZENOD_ALERT_NOW=2900 bash "$A" clear row-2 "Cloud app is green again" >/dev/null
check "green queues one RECOVERED" 1 "$(ls "$ZENOD_ALERT_QUEUE" | grep -c RECOVERED)"
ZENOD_ALERT_NOW=3000 bash "$A" clear row-2 "Cloud app is green again" >/dev/null
check "green again is silent" 3 "$(q)"
check "no temp file left beside the queue" 0 "$(ls -A "$T/base" | grep -c '^\.zenod-alert')"
rm -f "$ZENOD_ALERT_QUEUE"/*
ZENOD_ALERT_NOW=5000 bash "$A" alert row-2 page "$(printf 'two\nlines')" >/dev/null
check "newlines are flattened" "[ALERT] zenod test: two lines" "$(cat "$ZENOD_ALERT_QUEUE"/*.msg)"
bash "$A" clear row-2 "x" >/dev/null; rm -f "$ZENOD_ALERT_QUEUE"/*

# page rows: red alerts under the row key, other colours clear it; shares state with the watchdog keys
rows='[{"key":"row-4","name":"WhatsApp relay Phylax","colour":"red","signal":"WhatsApp closed"},
       {"key":"row-5","name":"Agent runner","colour":"grey","signal":"idle"},
       {"key":"row-12","name":"Host VPS1","colour":"amber","signal":"disk 85%"}]'
echo "$rows" | ZENOD_ALERT_NOW=6000 bash "$A" rows >/dev/null
check "page: one red row, one alert" "[ALERT] zenod test: WhatsApp relay Phylax is red: WhatsApp closed" "$(cat "$ZENOD_ALERT_QUEUE"/*.msg)"
ZENOD_ALERT_NOW=6100 bash "$A" alert row-4 page "WhatsApp relay Phylax is red: answered 502" >/dev/null
check "watchdog on the same row key is deduped" 1 "$(q)"
echo "${rows/\"red\"/\"green\"}" | ZENOD_ALERT_NOW=6200 bash "$A" rows >/dev/null
check "page: row green again, one RECOVERED" 1 "$(ls "$ZENOD_ALERT_QUEUE" | grep -c RECOVERED)"
check "the RECOVERED names the row" 1 "$(grep -c '^\[RECOVERED\] zenod test: WhatsApp relay Phylax is green again' "$ZENOD_ALERT_QUEUE"/*RECOVERED.msg)"

# S4: a key stays red while any caller sees it red (page smoke red vs watchdog green on the same row)
check "sources: add"            "a,b" "$(za_srcs_add a b)"
check "sources: add is a set"   "a,b" "$(za_srcs_add a,b b)"
check "sources: del"            "b"   "$(za_srcs_del a,b a)"
check "sources: del last"       ""    "$(za_srcs_del a a)"
rm -f "$ZENOD_ALERT_QUEUE"/*
echo '[{"key":"row-1","name":"Marketing site zenod.dev","colour":"red","signal":"smoke check failed"}]' \
  | ZENOD_ALERT_SOURCE="zenod health page" ZENOD_ALERT_NOW=8000 bash "$A" rows >/dev/null
check "page smoke red: one alert" 1 "$(q)"
ZENOD_ALERT_SOURCE="zenod watchdog" ZENOD_ALERT_NOW=8120 bash "$A" clear row-1 "Marketing site is green again" >/dev/null
check "watchdog green does not recover a row the page still has red" 0 "$(ls "$ZENOD_ALERT_QUEUE" | grep -c RECOVERED)"
ZENOD_ALERT_SOURCE="zenod watchdog" ZENOD_ALERT_NOW=8240 bash "$A" alert row-1 page "Marketing site is red: 502" >/dev/null
ZENOD_ALERT_SOURCE="zenod health page" ZENOD_ALERT_NOW=8300 bash "$A" alert row-1 page "Marketing site is red: 502" >/dev/null
check "both see the outage: still one alert" 1 "$(q)"
echo '[{"key":"row-1","name":"Marketing site zenod.dev","colour":"green","signal":""}]' \
  | ZENOD_ALERT_SOURCE="zenod health page" ZENOD_ALERT_NOW=8400 bash "$A" rows >/dev/null
check "page green while the watchdog still sees red: no RECOVERED" 0 "$(ls "$ZENOD_ALERT_QUEUE" | grep -c RECOVERED)"
ZENOD_ALERT_SOURCE="zenod watchdog" ZENOD_ALERT_NOW=8420 bash "$A" clear row-1 "Marketing site is green again" >/dev/null
check "both green: one RECOVERED" 1 "$(ls "$ZENOD_ALERT_QUEUE" | grep -c RECOVERED)"
ZENOD_ALERT_SOURCE="zenod health page" ZENOD_ALERT_NOW=9000 bash "$A" alert row-3 page "Database is red" >/dev/null
ZENOD_ALERT_SOURCE="zenod watchdog" ZENOD_ALERT_NOW=10900 bash "$A" clear row-3 "Database is green again" >/dev/null
check "a caller silent for 30 min no longer holds the key" 2 "$(ls "$ZENOD_ALERT_QUEUE" | grep -c RECOVERED)"
printf '7000 7000\n' > "$ZENOD_ALERT_STATE_DIR/alert.row-7"
ZENOD_ALERT_NOW=9100 bash "$A" clear row-7 "Deploy path is green again" >/dev/null
check "a state file from before S4 recovers on the first clear" 3 "$(ls "$ZENOD_ALERT_QUEUE" | grep -c RECOVERED)"
rm -f "$ZENOD_ALERT_QUEUE"/*

# EPIC-24 M24: a short blip does not page. za_hold_decide NOW FIRST LAST HOLD STALE
check "hold: off (0) goes at once"          go   "$(za_hold_decide 1000 0 0 0 900)"
check "hold: first sighting is held"        hold "$(za_hold_decide 1000 0 0 120 900)"
check "hold: second sighting 40 s later"    hold "$(za_hold_decide 1040 1000 1000 120 900)"
check "hold: second sighting 150 s later"   go   "$(za_hold_decide 1150 1000 1000 120 900)"
check "hold: chain broken for 20 min restarts" hold "$(za_hold_decide 2300 1000 1000 120 900)"
unset ZENOD_ALERT_HOLD_SECS
rm -f "$ZENOD_ALERT_QUEUE"/*; rm -f "$ZENOD_ALERT_STATE_DIR"/alert.* "$ZENOD_ALERT_STATE_DIR"/pending.*
# the 19 Nov 23:11Z case: one red run, green on the next: nothing queued, nothing to recover
ZENOD_ALERT_NOW=20000 bash "$A" alert row-1 page "Marketing site zenod.dev is red: answered 000" >/dev/null
check "blip: first red run queues nothing" 0 "$(q)"
check "blip: the held sighting is logged"  1 "$(grep -c 'HOLD\[row-1\]' "$ZENOD_ALERT_STATE_DIR/alert.log")"
ZENOD_ALERT_NOW=20150 bash "$A" clear row-1 "Marketing site zenod.dev is green again" >/dev/null
check "blip: green next run queues no RECOVERED" 0 "$(q)"
check "blip: no pending state is left" 0 "$(ls "$ZENOD_ALERT_STATE_DIR" | grep -c 'pending.row-1')"
ZENOD_ALERT_NOW=20300 bash "$A" alert row-1 page "Marketing site zenod.dev is red: answered 000" >/dev/null
check "a later blip starts fresh (still held)" 0 "$(q)"
ZENOD_ALERT_NOW=20450 bash "$A" alert row-1 page "Marketing site zenod.dev is red: answered 000" >/dev/null
check "a real outage: still red at the second run, one alert" 1 "$(q)"
check "real outage: the alert is the normal one" 1 "$(grep -c '^\[ALERT\] zenod test: Marketing site zenod.dev is red' "$ZENOD_ALERT_QUEUE"/*.msg)"
ZENOD_ALERT_NOW=20600 bash "$A" alert row-1 page "Marketing site zenod.dev is red: answered 000" >/dev/null
check "real outage: third run is deduped" 1 "$(q)"
ZENOD_ALERT_NOW=20700 bash "$A" clear row-1 "Marketing site zenod.dev is green again" >/dev/null
check "real outage: one RECOVERED" 1 "$(ls "$ZENOD_ALERT_QUEUE" | grep -c RECOVERED)"
rm -f "$ZENOD_ALERT_QUEUE"/*
# keys outside the hold set (Phylax row-4, the ingress tunnel row-11, docker-dead) still page at the first sighting
ZENOD_ALERT_NOW=21000 bash "$A" alert row-11 page "Ingress tunnel is red" >/dev/null
check "row-11 is not held" 1 "$(q)"
ZENOD_ALERT_NOW=21010 bash "$A" clear row-11 "Ingress tunnel is green again" >/dev/null
rm -f "$ZENOD_ALERT_QUEUE"/*
# the page probe (5 min cadence) goes through the same hold: a smoke red seen once never alerts, seen twice does
red='[{"key":"row-1","name":"Marketing site zenod.dev","colour":"red","signal":"smoke check failed: Home page answers: TimeoutError"}]'
echo "$red" | ZENOD_ALERT_SOURCE="zenod health page" ZENOD_ALERT_NOW=30000 bash "$A" rows >/dev/null
echo "${red/\"red\"/\"green\"}" | ZENOD_ALERT_SOURCE="zenod health page" ZENOD_ALERT_NOW=30300 bash "$A" rows >/dev/null
check "page smoke blip (21:41Z case): nothing queued" 0 "$(q)"
echo "$red" | ZENOD_ALERT_SOURCE="zenod health page" ZENOD_ALERT_NOW=31000 bash "$A" rows >/dev/null
echo "$red" | ZENOD_ALERT_SOURCE="zenod health page" ZENOD_ALERT_NOW=31300 bash "$A" rows >/dev/null
check "page smoke red twice, 5 min apart: one alert" 1 "$(q)"
echo "${red/\"red\"/\"green\"}" | ZENOD_ALERT_SOURCE="zenod health page" ZENOD_ALERT_NOW=31600 bash "$A" rows >/dev/null
rm -f "$ZENOD_ALERT_QUEUE"/*

# an unwritable queue reports delivery=no and keeps nothing as sent
chmod 500 "$T/base"; rm -rf "$ZENOD_ALERT_QUEUE" 2>/dev/null
out="$(ZENOD_ALERT_QUEUE="$T/base/missing/q" ZENOD_ALERT_NOW=7000 bash "$A" alert row-9 page "x" 2>&1)"; rc=$?
chmod 700 "$T/base"
if [ "$(id -u)" != 0 ]; then
  check "unwritable queue: exit 1" 1 "$rc"
  check "unwritable queue: logged delivery=no" 1 "$(printf '%s' "$out" | grep -c 'delivery=no')"
  check "unwritable queue: retried next run (no dedupe state)" 0 "$(ls "$ZENOD_ALERT_STATE_DIR" | grep -c row-9)"
fi

# sustained_red SINCE NOW MIN (EPIC-20 A5): WhatsApp red 5 minutes or more reaches the desk inbox
check "red 4 min: not yet"          no  "$(sustained_red 1000 1240 300)"
check "red exactly 5 min: yes"      yes "$(sustained_red 1000 1300 300)"
check "red 3 hours (19 Nov): yes"   yes "$(sustained_red 1000 9000 300)"

# outage_delta PREV CUR HHMM (EPIC-24 M21): items only when the red set changed; a recovered page says when
TAB=$'\t'
check "nothing red before or now: no note"   "" "$(outage_delta "" "" 06:00Z)"
check "same red set: no note"                "" "$(outage_delta "row-1${TAB}site 502" "row-1${TAB}site 502" 06:02Z)"
check "a page goes red: its line"            "row-1${TAB}site 502" "$(outage_delta "" "row-1${TAB}site 502" 06:12Z)"
check "it recovers: green again at"          "row-1${TAB}site 502, green again at 06:28Z" "$(outage_delta "row-1${TAB}site 502" "" 06:28Z)"
check "one of two recovers: both lines" 2    "$(outage_delta "row-1${TAB}a${TAB}x
row-2${TAB}b" "row-1${TAB}a${TAB}x" 07:00Z | wc -l | tr -d ' ')"

# outage_desk with a stand-in desk_note.py: writes once per change, keeps the marker, retries on failure
D="$T/desk"; mkdir -p "$D/clone/.git"
cat > "$D/dn.py" <<'PY'
import sys; open(sys.argv[0] + ".calls", "a").write(" ".join(a for a in sys.argv[1:] if a.startswith(("row-", "--item", "daily", "--key", "public"))) + "\n")
sys.exit(int(open(sys.argv[0] + ".rc").read()) if __import__("os").path.exists(sys.argv[0] + ".rc") else 0)
PY
calls() { [ -f "$D/dn.py.calls" ] && wc -l < "$D/dn.py.calls" | tr -d ' ' || echo 0; }
ZA_STATE="$T/za"; mkdir -p "$ZA_STATE"; OUTAGE_DESK_ON=1; OUTAGE_CLONE="$D/clone"; DESK_NOTE="$D/dn.py"
OUTAGE_NOW=""; outage_desk >/dev/null
check "all healthy, no marker: no desk call" 0 "$(calls)"
OUTAGE_NOW="row-1${TAB}Marketing site zenod.dev: https://zenod.dev/ answered 502 (expected 200)"$'\n'; outage_desk >/dev/null
check "zenod.dev 502: one desk call" 1 "$(calls)"
check "the call is the daily public-outage note" 1 "$(grep -c 'daily .*--key public-outage' "$D/dn.py.calls")"
check "marker holds the red page" 1 "$(grep -c '^row-1' "$ZA_STATE/outage-desk.red")"
outage_desk >/dev/null
check "still red, same set: no second call" 1 "$(calls)"
echo 1 > "$D/dn.py.rc"; OUTAGE_NOW=""; outage_desk >/dev/null
check "recovery whose note failed: called" 2 "$(calls)"
check "failed note keeps the marker (retry)" 1 "$([ -f "$ZA_STATE/outage-desk.red" ] && echo 1 || echo 0)"
rm -f "$D/dn.py.rc"; outage_desk >/dev/null
check "retry succeeds: called again" 3 "$(calls)"
check "the recovery line says green again" 1 "$(tail -1 "$D/dn.py.calls" | grep -c 'green')"
check "recovered: marker gone" 0 "$([ -f "$ZA_STATE/outage-desk.red" ] && echo 1 || echo 0)"
OUTAGE_DESK_ON=0; OUTAGE_NOW="row-2${TAB}cloud 502"$'\n'; outage_desk >/dev/null
check "ZENOD_WATCHDOG_OUTAGE_DESK=0: no call" 3 "$(calls)"

if [ "$fail" = 0 ]; then echo "ALL PASS"; else echo "FAILURES"; exit 1; fi
