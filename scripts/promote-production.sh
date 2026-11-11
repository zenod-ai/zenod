#!/usr/bin/env bash
# Root D28 (EPIC-24 M10): stable production, separate staging. Every push to main rolls STAGING
# (zenod-staging, tailnet only: http://100.104.206.10:8781) through the VPS1 deploy poller; production
# (zenod-mt, cloud.zenod.dev) moves only here, on a promote, once the standard question set passed for the
# exact commit staging runs. The Delivery Manager runs this on VPS3; nothing here is a step for Jordi.
#
#   scripts/promote-production.sh             gate the sha staging runs now, then promote it
#   scripts/promote-production.sh --sha X     the same for X (staging must be running X)
#   scripts/promote-production.sh --dry-run   run the gate, show the re-pin, change nothing
#   scripts/promote-production.sh --rollback  re-pin production to the image it ran before the last promote (no gate)
#
# The gate, in order (any failure stops before production is touched):
#   1. staging is healthy and reports the sha (healthz, /api/health sha, the app page and its script,
#      /api/settings refuses without a token, and the staging test tenant's health with its token);
#   2. the standard question set (memory test suite, EPIC-15 Q2) built at that sha is at or above
#      scripts/memory-eval/floor.json on the demo vault and, when present on this host, on the real-note set.
# Then `deploy-poller --promote zenod-mt --sha <sha>` on VPS1 re-pins production, waits for its health and
# rolls back by itself if the new image never turns healthy. Each promote is one line in
# ~/zenod-eval/promotions.jsonl (sha, previous sha, the gate's numbers, times).
set -euo pipefail
STAGING=${ZENOD_STAGING_URL:-http://100.104.206.10:8781}
PROD_HEALTH=${ZENOD_PROD_HEALTH:-https://cloud.zenod.dev/api/health}
VPS1=${ZENOD_VPS1:-hetzner_vps_1}
POLLER=${ZENOD_POLLER:-~/github/infra-vps/scripts/deploy-poller}
REPO=${ZENOD_REPO:-$(cd "$(dirname "$0")/.." && pwd)}
EVAL=${ZENOD_EVAL:-$HOME/zenod-eval}
DEPS=${ZENOD_DEPS:-$EVAL/deps}
TENANT_TOKEN=${ZENOD_STAGING_TENANT_TOKEN_FILE:-$HOME/.config/zenod-staging/tenant-token}
LOG=$EVAL/promotions.jsonl
umask 077

sha="" dry=0 rollback=0
while [ $# -gt 0 ]; do
  case "$1" in
    --sha) sha=$2; shift 2 ;;
    --dry-run) dry=1; shift ;;
    --rollback) rollback=1; shift ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
done

# The suite times every filing (three minutes on the real notes): on a box loaded far past its cores every
# filing runs out of time and the gate fails on load, not on the build (EPIC-24 M11). Wait for a quiet box,
# at most ZENOD_GATE_QUIET_WAIT seconds, then run anyway and say how loaded it was.
quiet() { # what
  local cores waited=0 limit=${ZENOD_GATE_QUIET_WAIT:-1200}
  cores=$(nproc)
  while awk -v c="$cores" '{ exit !($1 > c) }' /proc/loadavg && [ "$waited" -lt "$limit" ]; do
    [ "$waited" = 0 ] && echo "gate: waiting for a quiet box before the $1 set (load $(cut -d' ' -f1 /proc/loadavg), $cores cores)"
    sleep 30; waited=$((waited + 30))
  done
  awk -v c="$cores" '{ exit !($1 > c) }' /proc/loadavg && echo "gate: box still busy (load $(cut -d' ' -f1 /proc/loadavg)); the $1 set's times may fail on load" || true
}
health_sha() { curl -fsS -m 15 "$1" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("sha",""))'; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
prod_before=$(health_sha "$PROD_HEALTH" || true)
record() { # action sha gate
  printf '{"at":"%s","action":"%s","sha":"%s","previous":"%s","gate":%s}\n' "$(now)" "$1" "$2" "$prod_before" "${3:-null}" >> "$LOG"
}
promote() { # sha
  local flags=(--promote zenod-mt --sha "$1"); [ "$dry" = 1 ] && flags+=(--dry-run)
  # shellcheck disable=SC2029  # the poller path expands on VPS1
  ssh "$VPS1" "$POLLER ${flags[*]}"
}

if [ "$rollback" = 1 ]; then
  prev=$(python3 -c 'import json,sys
rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
rows=[r for r in rows if r["action"]=="promote" and r["previous"]]
print(rows[-1]["previous"] if rows else "")' "$LOG" 2>/dev/null || true)
  [ -n "$prev" ] || { echo "rollback: no earlier promote recorded in $LOG" >&2; exit 1; }
  echo "rollback: production $prod_before -> $prev (no gate)"
  promote "$prev"
  [ "$dry" = 1 ] || { [ "$(health_sha "$PROD_HEALTH")" = "$prev" ] && record rollback "$prev"; }
  exit 0
fi

# 1. Staging runs the candidate and answers like production would.
live=$(health_sha "$STAGING/api/health")
[ -n "$sha" ] || sha=$live
[ "${live:0:${#sha}}" = "$sha" ] || { echo "gate: staging runs ${live:0:7}, not $sha; push it to main and let staging roll first" >&2; exit 1; }
sha=$live
curl -fsS -m 10 "$STAGING/healthz" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("status")=="ok" and d.get("name")=="zenod" else 1)'
asset=$(curl -fsS -m 10 "$STAGING/" | sed -n 's/.*src="\([^"]*\.js\)".*/\1/p' | head -1)
[ -n "$asset" ] && curl -fsS -m 10 -o /dev/null "$STAGING$asset"
[ "$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$STAGING/api/settings")" = 401 ]
if [ -r "$TENANT_TOKEN" ]; then
  curl -fsS -m 10 -H "Authorization: Bearer $(cat "$TENANT_TOKEN")" "$STAGING/api/health" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("status")=="ok" and d.get("sha")==sys.argv[1] else 1)' "$sha"
fi
echo "gate 1/2: staging healthy on ${sha:0:7}"

# 2. The standard question set on that exact commit (its own build dir, so the nightly run is not disturbed).
git -C "$REPO" fetch -q origin main
if [ ! -d "$DEPS/node_modules" ]; then
  [ -d "$DEPS" ] || git -C "$REPO" worktree add -q --detach "$DEPS" origin/main
  (cd "$DEPS" && npm ci --no-audit --no-fund >/dev/null)
fi
work="$EVAL/promote"
rm -rf "$work/suite" && mkdir -p "$work/suite" "$work/runs"
git -C "$REPO" archive origin/main scripts/memory-eval packages/core/test/fixtures/tree-vault | tar -x -C "$work/suite"
suite="$work/suite/scripts/memory-eval"
build="$work/build"
[ -f "$build/.memory-eval-built" ] && [ "$(cat "$build/.memory-eval-built")" != "$sha" ] && { git -C "$REPO" worktree remove --force "$build" 2>/dev/null || rm -rf "$build"; }
nice -n 10 bash "$suite/build-at.sh" "$REPO" "$sha" "$build" "$DEPS" >/dev/null
s7=${sha:0:7}
quiet demo
nice -n 10 node "$suite/run.mjs" --checkout "$build" --dataset demo --sha "$s7" --label "staging $s7" \
  --out "$work/runs/demo-$s7.json" --floor "$suite/floor.json" 2>&1 | grep -E '^ingestion|below its floor'
gate=$(python3 -c 'import json,sys; r=json.load(open(sys.argv[1]))["record"]; print(json.dumps({"demo":[r.get(k) for k in ("ingestionSuccess","retrievalEfficiency","errorRate")]}))' "$work/runs/demo-$s7.json")
VAULT_CLONE=${ZENOD_VAULT_CLONE:-/var/lib/vps3-scratch/t3agent/github/obsidian-brain}
if [ -f "$EVAL/real-questions.jsonl" ] && [ -d "$VAULT_CLONE/.git" ]; then
  git -C "$VAULT_CLONE" fetch -q origin
  rev=$(git -C "$VAULT_CLONE" rev-parse --short=7 origin/main)
  # Copy into a temporary dir and rename it into place, so a copy cut short never stands as that revision.
  if [ ! -d "$EVAL/vaults/$rev" ]; then
    rm -rf "$EVAL/vaults/.$rev.partial" && mkdir -p "$EVAL/vaults/.$rev.partial"
    git -C "$VAULT_CLONE" archive "$rev" | tar -x -C "$EVAL/vaults/.$rev.partial"
    mv "$EVAL/vaults/.$rev.partial" "$EVAL/vaults/$rev"
  fi
  quiet private
  nice -n 10 node "$suite/run.mjs" --checkout "$build" --dataset private --vault "$EVAL/vaults/$rev" --vault-rev "$rev" --vault-git "$VAULT_CLONE" \
    --questions "$EVAL/real-questions.jsonl" --judged "$HOME/zenod-feedback/landing-feedback.jsonl,$EVAL/vaults/$rev/.brain/tree-corrections.jsonl" \
    --sha "$s7" --label "staging $s7" --out "$work/runs/private-$s7.json" --floor "$suite/floor.json" 2>&1 | grep -E '^ingestion|below its floor'
  gate=$(python3 -c 'import json,sys; g=json.loads(sys.argv[1]); r=json.load(open(sys.argv[2]))["record"]; g["private"]=[r.get(k) for k in ("ingestionSuccess","retrievalEfficiency","errorRate")]; print(json.dumps(g))' "$gate" "$work/runs/private-$s7.json")
fi
echo "gate 2/2: question set passed on $s7: $gate"

# 3. Promote: re-pin production to the image staging runs.
if [ "$prod_before" = "$sha" ]; then echo "production already runs $s7"; exit 0; fi
echo "promote: production ${prod_before:0:7} -> $s7 (undo: scripts/promote-production.sh --rollback)"
promote "$sha"
[ "$dry" = 1 ] && exit 0
after=$(health_sha "$PROD_HEALTH" || true)
[ "$after" = "$sha" ] || { echo "promote: production reports ${after:0:7}, not $s7 (the poller rolled back if the image failed)" >&2; record failed "$sha" "$gate"; exit 1; }
record promote "$sha" "$gate"
echo "promoted: production runs $s7 since $(now)"
