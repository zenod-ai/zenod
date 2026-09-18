#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

if [[ ! -x "$CHROME" ]]; then
  echo "Chrome not found at: $CHROME" >&2
  exit 1
fi

shopt -s nullglob
files=()
for candidate in "$ROOT"/slides/*.html; do
  [[ "$(basename "$candidate")" == _* ]] && continue
  files+=("$candidate")
done
if (( ${#files[@]} == 0 )); then
  echo "No slide HTML files found in $ROOT/slides" >&2
  exit 1
fi

for html in "${files[@]}"; do
  png="${html%.html}.png"
  echo "rendering $(basename "$html")"
  "$CHROME" \
    --headless=new \
    --hide-scrollbars \
    --disable-gpu \
    --no-sandbox \
    --force-device-scale-factor=1 \
    --window-size=1678,937 \
    --screenshot="$png" \
    "file://$html" >/dev/null 2>&1
done

echo "rendered ${#files[@]} slide(s)"
