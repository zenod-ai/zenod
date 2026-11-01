#!/usr/bin/env bash
# Install tester-watch on VPS1 (EPIC-7 T6). Re-runnable; run from a checkout of main.
#   sudo bash scripts/tester-watch/install.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST=/usr/local/lib/zenod-tester-watch
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
install -d -m 0755 "$DEST"
install -m 0755 "$SRC/tester_watch.py" "$DEST/tester_watch.py"
git -c safe.directory="*" -C "$SRC" rev-parse HEAD > "$DEST/SOURCE_SHA" 2>/dev/null || true
cat > /usr/local/bin/tester-watch <<'WRAP'
#!/bin/sh
# EPIC-7 T6: read-only per-tester view. Needs root (prod volumes, zenod-mt env).
[ "$(id -u)" = 0 ] || exec sudo -n "$0" "$@"
exec /usr/bin/python3 /usr/local/lib/zenod-tester-watch/tester_watch.py "$@"
WRAP
chmod 0755 /usr/local/bin/tester-watch
echo "installed tester-watch $(cat "$DEST/SOURCE_SHA" 2>/dev/null || echo '?')"
