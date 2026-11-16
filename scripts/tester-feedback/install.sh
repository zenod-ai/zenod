#!/usr/bin/env bash
# Install the tester voice feedback links on vps3 as the t3agent user (EPIC-7 E7-S9). Re-runnable.
#   bash scripts/tester-feedback/install.sh
# Way back: systemctl --user disable --now zenod-tester-feedback.timer
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
UNITS="$HOME/.config/systemd/user"
install -d "$UNITS"
install -m 0644 "$SRC/zenod-tester-feedback.service" "$SRC/zenod-tester-feedback.timer" "$UNITS/"
systemctl --user daemon-reload
systemctl --user enable --now zenod-tester-feedback.timer
systemctl --user list-timers zenod-tester-feedback.timer --no-pager | head -3
