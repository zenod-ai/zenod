#!/usr/bin/env bash
# Install the stuck sign-up check on vps3 as the t3agent user (EPIC-26 E26-S31). Re-runnable.
#   bash scripts/tester-stuck/install.sh
# Way back: systemctl --user disable --now zenod-tester-stuck.timer
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
UNITS="$HOME/.config/systemd/user"
install -d "$UNITS"
install -m 0644 "$SRC/zenod-tester-stuck.service" "$SRC/zenod-tester-stuck.timer" "$UNITS/"
systemctl --user daemon-reload
systemctl --user enable --now zenod-tester-stuck.timer
systemctl --user list-timers zenod-tester-stuck.timer --no-pager | head -3
