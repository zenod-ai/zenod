#!/usr/bin/env bash
# E15-Q2: the memory test suite on VPS3, after every production roll and once a night.
# Runs the demo suite and the person's real-note suite on the code production runs (plus the live-model
# slice on Claude through staging, weekly), appends one dated
# record each to the private history, and redraws the dashboard (served at :8921/memory-tests/).
# The vault is a read-only clone; each run works on a throwaway copy and never pushes.
#
# Driven by the user timer zenod-memory-tests.timer (every 30 minutes): it runs when production's sha
# changed since the last run, or when the last run is more than 24 hours old.
set -euo pipefail
REPO=${ZENOD_REPO:-/var/lib/vps3-scratch/t3agent/github/zenod}
VAULT_CLONE=${ZENOD_VAULT_CLONE:-/var/lib/vps3-scratch/t3agent/github/obsidian-brain}
EVAL=${ZENOD_EVAL:-$HOME/zenod-eval}
DEPS=${ZENOD_DEPS:-$EVAL/deps}
PAGE=${ZENOD_PAGE:-$HOME/zenod-evidence-pages/memory-tests/index.html}
umask 077
mkdir -p "$EVAL/history" "$EVAL/builds" "$EVAL/vaults" "$EVAL/runs"

sha=$(curl -fsS -m 20 https://cloud.zenod.dev/api/health | python3 -c 'import json,sys; print(json.load(sys.stdin).get("sha","")[:7])' || true)
[ -n "$sha" ] || { echo "no production sha; skip"; exit 0; }
stamp="$EVAL/history/.last"
if [ -f "$stamp" ] && [ "$(cut -d' ' -f1 "$stamp")" = "$sha" ] && [ $(( $(date +%s) - $(cut -d' ' -f2 "$stamp") )) -lt 86400 ] && [ "${1:-}" != "--force" ]; then
  echo "production $sha already measured"; exit 0
fi

git -C "$REPO" fetch -q origin main
# One dependency install shared by every build.
if [ ! -d "$DEPS/node_modules" ]; then
  [ -d "$DEPS" ] || git -C "$REPO" worktree add -q --detach "$DEPS" origin/main
  (cd "$DEPS" && npm ci --no-audit --no-fund >/dev/null)
fi
# The suite and its data come from main; only the code under test is production's.
rm -rf "$EVAL/suite" && mkdir -p "$EVAL/suite"
git -C "$REPO" archive origin/main scripts/memory-eval packages/core/test/fixtures/tree-vault | tar -x -C "$EVAL/suite"
suite="$EVAL/suite/scripts/memory-eval"
full=$(git -C "$REPO" rev-parse "$sha")
build="$EVAL/builds/$sha"
nice -n 10 bash "$suite/build-at.sh" "$REPO" "$full" "$build" "$DEPS"

git -C "$VAULT_CLONE" fetch -q origin
rev=$(git -C "$VAULT_CLONE" rev-parse --short=7 origin/main)
[ -d "$EVAL/vaults/$rev" ] || { mkdir -p "$EVAL/vaults/$rev"; git -C "$VAULT_CLONE" archive "origin/main" | tar -x -C "$EVAL/vaults/$rev"; }

label="production $(date -u +%m-%d) $sha"
nice -n 10 node "$suite/run.mjs" --checkout "$build" --dataset demo --sha "$sha" --label "$label" --out "$EVAL/runs/demo-$sha.json" --append "$EVAL/history/demo.jsonl" 2>&1 | grep '^ingestion' || true
nice -n 10 node "$suite/run.mjs" --checkout "$build" --dataset private --vault "$EVAL/vaults/$rev" --vault-rev "$rev" --vault-git "$VAULT_CLONE" \
  --questions "$EVAL/real-questions.jsonl" --judged "$HOME/zenod-feedback/landing-feedback.jsonl,$EVAL/vaults/$rev/.brain/tree-corrections.jsonl" \
  --sha "$sha" --label "$label" --out "$EVAL/runs/private-$sha.json" --append "$EVAL/history/private.jsonl" 2>&1 | grep '^ingestion' || true

# Live tier (E15-Q3, on Claude since E7-S3 iteration 3): the fixed slice of the real set (the 20 rq questions
# and the 8 judged notes) with the models production runs, Claude Haiku filing and Claude Sonnet answering,
# next to the free stand-in on the same slice. The calls run inside zenod-staging on its Anthropic credit
# route and its own monthly cap (POST /api/credit/eval-call, live.mjs stagingLive): no model key on this host,
# only the staging test tenant's token (~/.config/zenod-staging/tenant-token, 0600). Jordi 2026-11-12: no new
# key; the DeepSeek tier this replaced (zenod-tests key) is retired, production no longer runs on DeepSeek.
# A Claude run costs about 45 cents (Sonnet answers), so it runs once a week, or with --force; cached calls
# cost nothing; caps: 60 cents a run, 2 dollars a month here, 3 dollars a month on staging's side.
live_stamp="$EVAL/history/.last-live-claude"
if [ "${1:-}" = "--force" ] || ! { [ -f "$live_stamp" ] && [ $(( $(date +%s) - $(cut -d' ' -f2 "$live_stamp") )) -lt $(( ${ZENOD_LIVE_EVERY_DAYS:-7} * 86400 )) ]; }; then
  slice=(--checkout "$build" --dataset private --vault "$EVAL/vaults/$rev" --vault-rev "$rev" --questions "$EVAL/real-questions.jsonl"
    --judged "$HOME/zenod-feedback/landing-feedback.jsonl" --slice rq --skip agent --sha "$sha" --label "$label" --append "$EVAL/history/live.jsonl")
  if nice -n 10 node "$suite/run.mjs" "${slice[@]}" --model live --live-provider staging \
       --live-dir "$EVAL/live-claude" --live-run-cap "${ZENOD_LIVE_RUN_CAP:-0.6}" --live-month-cap "${ZENOD_LIVE_MONTH_CAP:-2}" \
       --out "$EVAL/runs/live-$sha.json" 2>&1 | grep -E '^(live|ingestion)'; then
    nice -n 10 node "$suite/run.mjs" "${slice[@]}" --out "$EVAL/runs/live-standin-$sha.json" 2>&1 | grep '^ingestion' || true
    echo "$sha $(date +%s)" > "$live_stamp"
  else echo "live: Claude via staging skipped (staging down or the run failed)"; fi
fi

node "$suite/dashboard.mjs" --demo "$EVAL/history/demo.jsonl" --private "$EVAL/history/private.jsonl" --live "$EVAL/history/live.jsonl" \
  --changes "$suite/changes.json" --recorded "$suite/recorded.json" --out "$PAGE"
chmod -R a+rX "$(dirname "$PAGE")"
echo "$sha $(date +%s)" > "$stamp"
# Keep the three newest builds.
ls -1dt "$EVAL"/builds/*/ 2>/dev/null | tail -n +4 | while read -r old; do git -C "$REPO" worktree remove --force "$old" 2>/dev/null || rm -rf "$old"; done
