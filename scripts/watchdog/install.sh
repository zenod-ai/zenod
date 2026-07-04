#!/usr/bin/env bash
# Install the zenod-watchdog (Epic-1 closure gate C-24/C-25 · #570) on the VPS host.
# One-time host setup — the watchdog is host-level BY DESIGN (it must survive the stack /
# Docker being down), so it cannot be a Dokploy compose. Re-runnable (idempotent).
#
#   sudo ZENOD_NOTIFY_TOKEN=... ZENOD_WATCHDOG_FALLBACK_URL=https://ntfy.sh/<topic> \
#     bash scripts/watchdog/install.sh
#
# Also installs Docker log rotation — the missing guardrail behind #570 (runaway container
# logs filled the disk → Postgres FATAL → dead stack). New/recreated containers pick it up.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST=/opt/zenod-watchdog
ENVF=/etc/zenod-watchdog.env

[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }

echo "== installing watchdog script -> $DEST =="
install -d "$DEST"
install -m 0755 "$SRC/zenod-watchdog.sh" "$DEST/zenod-watchdog.sh"

echo "== env file $ENVF (edit to add NOTIFY_TOKEN / FALLBACK_URL) =="
if [ ! -f "$ENVF" ]; then
  cat > "$ENVF" <<EOF
# zenod-watchdog config. Restrict: chmod 600.
ZENOD_NOTIFY_URL=${ZENOD_NOTIFY_URL:-https://c1.zenod.dev}
ZENOD_NOTIFY_TOKEN=${ZENOD_NOTIFY_TOKEN:-}
# Out-of-band page for when the Console itself is down (ntfy topic / Telegram sendMessage URL / …):
ZENOD_WATCHDOG_FALLBACK_URL=${ZENOD_WATCHDOG_FALLBACK_URL:-}
ZENOD_WATCHDOG_DISK_WARN=${ZENOD_WATCHDOG_DISK_WARN:-80}
ZENOD_WATCHDOG_DISK_PAGE=${ZENOD_WATCHDOG_DISK_PAGE:-90}
EOF
  chmod 600 "$ENVF"
else
  echo "   (exists — left untouched; edit by hand to change tokens)"
fi

echo "== systemd units =="
install -m 0644 "$SRC/zenod-watchdog.service" /etc/systemd/system/zenod-watchdog.service
install -m 0644 "$SRC/zenod-watchdog.timer" /etc/systemd/system/zenod-watchdog.timer
systemctl daemon-reload
systemctl enable --now zenod-watchdog.timer
echo "   timer: $(systemctl is-enabled zenod-watchdog.timer) / $(systemctl is-active zenod-watchdog.timer)"

echo "== Docker log rotation (#570 disk-full guardrail) =="
DJ=/etc/docker/daemon.json
install -d /etc/docker
if [ -f "$DJ" ] && grep -q '"log-opts"' "$DJ" 2>/dev/null; then
  echo "   daemon.json already has log-opts — leaving it (verify max-size/max-file by hand)."
else
  # Merge log-opts into existing daemon.json (or create it). Requires jq; falls back to a
  # fresh file. Applying needs a daemon restart — do that in a maintenance window, NOT
  # mid-incident, and only after confirming disk headroom.
  TMP="$(mktemp)"
  if command -v jq >/dev/null 2>&1 && [ -s "$DJ" ]; then
    jq '. + {"log-driver":"json-file","log-opts":{"max-size":"50m","max-file":"5"}}' "$DJ" > "$TMP" && mv "$TMP" "$DJ"
  else
    cat > "$DJ" <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
EOF
  fi
  echo "   wrote log rotation to $DJ (max-size 50m, max-file 5)."
  echo "   >>> APPLY in a maintenance window:  systemctl restart docker   (restarts all containers)."
fi

echo "== done. First run: =="
systemctl start zenod-watchdog.service && journalctl -u zenod-watchdog.service -n 8 --no-pager || true
