#!/usr/bin/env bash
# Install (or refresh) the hourly promote timer for the current user on VPS3 (EPIC-24 M12).
#   bash scripts/promote-schedule/install.sh            install + enable
#   bash scripts/promote-schedule/install.sh --remove   stop, disable, delete the units
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
dir=$HOME/.config/systemd/user
if [ "${1:-}" = --remove ]; then
  systemctl --user disable --now zenod-promote-tick.timer 2>/dev/null || true
  rm -f "$dir/zenod-promote-tick.service" "$dir/zenod-promote-tick.timer"
  systemctl --user daemon-reload; echo "removed"; exit 0
fi
mkdir -p "$dir" "$HOME/zenod-eval"
install -m 644 "$here/zenod-promote-tick.service" "$here/zenod-promote-tick.timer" "$dir/"
systemctl --user daemon-reload
systemctl --user enable --now zenod-promote-tick.timer
systemctl --user list-timers zenod-promote-tick.timer --no-pager
