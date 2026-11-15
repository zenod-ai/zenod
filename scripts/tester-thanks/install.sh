#!/usr/bin/env bash
# Install the tester thank-you timer on vps3 as the t3agent user (EPIC-26 E26-S28). Re-runnable.
#   bash scripts/tester-thanks/install.sh
# Way back: systemctl --user disable --now zenod-tester-thanks.timer
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
UNITS="$HOME/.config/systemd/user"
install -d "$UNITS" "$HOME/.local/lib"
install -m 0644 "$SRC/zenod-tester-thanks.service" "$SRC/zenod-tester-thanks.timer" "$UNITS/"
systemctl --user daemon-reload
systemctl --user enable --now zenod-tester-thanks.timer
systemctl --user list-timers zenod-tester-thanks.timer --no-pager | head -3
