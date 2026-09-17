#!/usr/bin/env bash
# Verify that the vendored EpicSpine skill matches its pinned manifest.
#
# Usage:
#   scripts/ci/check-epicspine-vendored.sh          # check (default)
#   scripts/ci/check-epicspine-vendored.sh --write   # refresh the manifest
#
# The vendored copy is a snapshot of skill/epic-spine from
# https://github.com/AlfaBlok/epicspine-skill. See skills/epic-spine.SOURCE.
# Drift means someone edited the copy instead of re-syncing it from the source.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

dir="skills/epic-spine"
manifest="skills/epic-spine.manifest.sha256"

if [ ! -d "$dir" ]; then
  echo "ERROR: $dir not found; run from the repository root." >&2
  exit 1
fi

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}
export -f hash_file

generate() {
  find "$dir" -type f | LC_ALL=C sort | while IFS= read -r file; do
    printf '%s  %s\n' "$(hash_file "$file")" "$file"
  done
}

case "${1:-}" in
  --write)
    generate > "$manifest"
    echo "Wrote $manifest"
    ;;
  "")
    if [ ! -f "$manifest" ]; then
      echo "ERROR: $manifest not found. Run with --write to create it." >&2
      exit 1
    fi
    if diff -u "$manifest" <(generate); then
      echo "Vendored EpicSpine skill matches $manifest."
    else
      echo >&2
      echo "ERROR: vendored EpicSpine skill drifted from $manifest." >&2
      echo "Re-sync from $(sed -n 's/^source: //p' skills/epic-spine.SOURCE) and run --write." >&2
      exit 1
    fi
    ;;
  *)
    echo "Usage: $0 [--write]" >&2
    exit 2
    ;;
esac
