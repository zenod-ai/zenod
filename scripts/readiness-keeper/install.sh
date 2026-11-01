#!/usr/bin/env bash
# Install zenod-readiness-keeper on VPS1 (EPIC-7 T2.3). Re-runnable; run from a checkout of main.
#   sudo bash scripts/readiness-keeper/install.sh
# Re-run after any change to keeper.py or scripts/zenod-volume-backup.sh (the drill runs the
# installed copy of that script).
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST=/usr/local/lib/zenod-readiness-keeper
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
install -d -m 0755 "$DEST"
install -m 0755 "$SRC/keeper.py" "$DEST/keeper.py"
install -m 0755 "$SRC/../zenod-volume-backup.sh" "$DEST/zenod-volume-backup.sh"
git -C "$SRC" rev-parse HEAD > "$DEST/SOURCE_SHA" 2>/dev/null || true
for u in zenod-readiness-keeper.service zenod-readiness-keeper.timer zenod-readiness-watch.service zenod-readiness-watch.timer; do
  install -m 0644 "$SRC/$u" "/etc/systemd/system/$u"
done
systemctl daemon-reload
systemctl enable --now zenod-readiness-keeper.timer zenod-readiness-watch.timer
systemctl list-timers --no-pager 'zenod-readiness-*'
