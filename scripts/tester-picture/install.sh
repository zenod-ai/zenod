#!/usr/bin/env bash
# Install the daily tester picture timer and its page host unit on vps3 as the t3agent user (EPIC-7 E7-S17, E7-S27). Re-runnable.
#   bash scripts/tester-picture/install.sh
# Way back: systemctl --user disable --now zenod-tester-picture.timer zenod-tester-table-page.service
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
UNITS="$HOME/.config/systemd/user"
install -d "$UNITS"
install -m 0644 "$SRC/zenod-tester-picture.service" "$SRC/zenod-tester-picture.timer" "$SRC/zenod-tester-table-page.service" "$UNITS/"
systemctl --user daemon-reload
systemctl --user enable --now zenod-tester-picture.timer
systemctl --user enable --now zenod-tester-table-page.service
systemctl --user list-timers zenod-tester-picture.timer --no-pager | head -3
