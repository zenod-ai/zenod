#!/usr/bin/env bash
# E10-S1 guard (EPIC-10, docs/zenod-in-every-mcp-directory-listing-spr.md).
# Our address is zenod.dev. The official MCP Registry once listed Zenod under a
# name that writes the domain backwards (the registry's rule for names proven
# by DNS), and directories copied it, so public listings showed what looked like
# a wrong address. Jordi, 2026-11-12: "I don't want it kept anywhere."
# Zenod is now listed under io.github.zenod-ai/zenod with title "Zenod" and
# website https://zenod.dev. This check fails if the backwards form comes back
# in anything a person can read: listing copy (server.json, glama.json), the
# site, READMEs, cards, evidence pages, code and tests.
#
# Not scanned: the spines (docs/*.md at the top level), Log/** and desk/**,
# which hold Jordi's own words and the team's running notes; their stewards
# keep them clean by hand.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pattern='dev[.]zenod'
hits=$(git ls-files -z \
  | grep -zv -E '^(docs/[^/]+\.md|Log/.*|desk/.*)$' \
  | xargs -0 grep -I -n -i -E "$pattern" -- 2>/dev/null || true)
# File names count too (a screenshot named after the old listing).
names=$(git ls-files | grep -i -E "$pattern" || true)
if [ -n "$hits$names" ]; then
  echo "The backwards form of zenod.dev is back. Write Zenod and https://zenod.dev instead:"
  [ -n "$hits" ] && echo "$hits"
  [ -n "$names" ] && echo "$names"
  exit 1
fi
echo "ok: no backwards zenod.dev in listing copy, pages, code or docs"
