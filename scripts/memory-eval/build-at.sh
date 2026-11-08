#!/usr/bin/env bash
# E15-Q2: build Zenod's core, chassis and server at one commit, for the memory test suite to replay it.
# A detached worktree shares the dependencies of an installed checkout (no npm install per commit):
# every package is linked from there except Zenod's own, which point at this commit's packages.
#
# usage: build-at.sh <repo> <sha> <out dir> <installed checkout>
set -euo pipefail
repo=$1 sha=$2 out=$3 deps=$4
if [ -f "$out/.memory-eval-built" ] && [ "$(cat "$out/.memory-eval-built")" = "$sha" ]; then echo "$out ready"; exit 0; fi
[ -d "$out" ] || git -C "$repo" worktree add -q --detach "$out" "$sha"
mkdir -p "$out/node_modules/@zenod"
for entry in "$deps"/node_modules/* "$deps"/node_modules/.bin; do
  name=$(basename "$entry")
  case "$name" in zenod|@zenod) continue ;; esac
  [ -e "$out/node_modules/$name" ] || ln -s "$entry" "$out/node_modules/$name"
done
ln -sfn ../packages/core "$out/node_modules/zenod"
for pkg in mcp-chassis server; do ln -sfn ../../packages/$pkg "$out/node_modules/@zenod/$pkg"; done
for pkg in core mcp-chassis server; do
  [ -d "$out/packages/$pkg" ] || continue
  # Packages that need their own version of a dependency keep it in a nested node_modules.
  if [ -d "$deps/packages/$pkg/node_modules" ] && [ ! -e "$out/packages/$pkg/node_modules" ]; then
    ln -s "$deps/packages/$pkg/node_modules" "$out/packages/$pkg/node_modules"
  fi
  # The server's own build first checks the tool schemas; the suite needs only its compiled code.
  (cd "$out/packages/$pkg" && npx tsc -p .)
done
echo "$sha" > "$out/.memory-eval-built"
echo "$out built at $sha"
