#!/usr/bin/env bash
# Install the zenod-watchdog (Epic-1 closure gate C-24 · #570, repointed in EPIC-6 S5) on VPS1.
# Runs as the account that owns the HQ alert queue (~/agent_team_m0/alerts.pending, normally t3agent) as a
# systemd --user timer: no root needed (linger keeps it running without a login). Re-runnable (idempotent).
#
#   bash scripts/watchdog/install.sh                          # install/refresh and run once
#   sudo bash scripts/watchdog/install.sh --docker-log-rotation   # root only: the #570 log rotation guardrail
#
# The old root unit (system zenod-watchdog.timer, /opt/zenod-watchdog, /etc/zenod-watchdog.env) checked hosts that
# no longer exist and sent to a retired endpoint. Retiring it is a root step:
#   sudo systemctl disable --now zenod-watchdog.timer
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" = "--docker-log-rotation" ]; then
  # Docker log rotation — the missing guardrail behind #570 (runaway container logs filled the disk →
  # Postgres FATAL → dead stack). New/recreated containers pick it up.
  [ "$(id -u)" = 0 ] || { echo "run as root (sudo) for --docker-log-rotation"; exit 1; }
  DJ=/etc/docker/daemon.json
  install -d /etc/docker
  if [ -f "$DJ" ] && grep -q '"log-opts"' "$DJ" 2>/dev/null; then
    echo "daemon.json already has log-opts — leaving it (verify max-size/max-file by hand)."
  else
    TMP="$(mktemp)"
    if command -v jq >/dev/null 2>&1 && [ -s "$DJ" ]; then
      jq '. + {"log-driver":"json-file","log-opts":{"max-size":"50m","max-file":"5"}}' "$DJ" > "$TMP" && mv "$TMP" "$DJ"
    else
      printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "50m", "max-file": "5" }\n}\n' > "$DJ"
    fi
    echo "wrote log rotation to $DJ (max-size 50m, max-file 5)."
    echo ">>> APPLY in a maintenance window:  systemctl restart docker   (restarts all containers)."
  fi
  exit 0
fi

[ "$(id -u)" != 0 ] || { echo "run as the account that owns ~/agent_team_m0/alerts.pending, not root"; exit 1; }
[ -d "$HOME/agent_team_m0/alerts.pending" ] || { echo "no HQ alert queue at ~/agent_team_m0/alerts.pending"; exit 1; }

DEST="$HOME/.local/share/zenod-watchdog"
UNITS="$HOME/.config/systemd/user"
echo "== scripts -> $DEST =="
install -d "$DEST" "$UNITS"
install -m 0755 "$SRC/zenod-watchdog.sh" "$SRC/zenod-alert.sh" "$DEST/"
ln -sf "$DEST/zenod-alert.sh" "$HOME/.local/bin/zenod-alert" 2>/dev/null || true

echo "== user units =="
install -m 0644 "$SRC/zenod-health-watchdog.service" "$SRC/zenod-health-watchdog.timer" "$UNITS/"
systemctl --user daemon-reload
systemctl --user enable --now zenod-health-watchdog.timer
echo "   timer: $(systemctl --user is-enabled zenod-health-watchdog.timer) / $(systemctl --user is-active zenod-health-watchdog.timer)"

echo "== first run =="
systemctl --user start zenod-health-watchdog.service || true
journalctl --user -u zenod-health-watchdog.service -n 12 --no-pager -o cat || true
if systemctl is-enabled --quiet zenod-watchdog.timer 2>/dev/null; then
  echo "NOTE: the retired root unit zenod-watchdog.timer is still enabled: sudo systemctl disable --now zenod-watchdog.timer"
fi
