#!/usr/bin/env bash
# Unit test for zenod-watchdog's pure decision logic (Epic-1 C-24 · #570).
# Sources the watchdog in LIB_ONLY mode so no live check runs, then asserts the threshold
# and crash-loop rules. Run: bash scripts/watchdog/watchdog-logic.test.sh
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

# crashloop NOW PREV MAX  (delta > MAX => crash-loop)
check "0 new restarts: no"      no   "$(crashloop 3 3 5)"
check "5 new restarts: no (=max)" no "$(crashloop 8 3 5)"
check "6 new restarts: yes"     yes  "$(crashloop 9 3 5)"
check "big jump: yes"           yes  "$(crashloop 41 10 5)"
check "first-seen small: no"    no   "$(crashloop 1 0 5)"

if [ "$fail" = 0 ]; then echo "ALL PASS"; else echo "FAILURES"; exit 1; fi
