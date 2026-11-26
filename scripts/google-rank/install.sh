#!/usr/bin/env bash
# Install the weekly Google rank on vps3 as the t3agent user (E7-S43). Re-runnable.
#   bash scripts/google-rank/install.sh
# Way back: systemctl --user disable --now zenod-google-rank.timer
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
UNITS="$HOME/.config/systemd/user"
install -d "$UNITS"
install -m 0644 "$SRC/zenod-google-rank.service" "$SRC/zenod-google-rank.timer" "$UNITS/"
systemctl --user daemon-reload
systemctl --user enable --now zenod-google-rank.timer
systemctl --user list-timers zenod-google-rank.timer --no-pager | head -3
